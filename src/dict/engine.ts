import type { FromWorker, MetaReply, Request, ToWorker, WordChar, WordDetail } from './protocol'
import { pickCharRow } from './mainForm'
import { numberedSyllables } from './pinyin'
import { COL, hanChars } from './row'
import { DictIndex, INDEX_FORMAT, IndexBuilder, type IndexParts, type RawHit } from './searchIndex'
import { COLUMNS, type CharInfo, type DictEntry, type DictStatus, type Manifest, type SearchHit, type SearchResult, type ShardInfo } from './types'

/**
 * The dictionary worker's logic, free of worker globals so tests run it in-process: loads the
 * manifest (network first; the copy saved on the device when offline), downloads the shards (core
 * first, then the rest in the background) with retries, a stall timeout and a SHA-256 check, builds
 * the index in time slices so searches are answered meanwhile, and saves a snapshot of the finished
 * index in IndexedDB so the next start needs neither download nor build.
 */

export interface SavedMeta {
  manifestUrl: string
  manifest: Manifest
  available: string | null
}

/** Device storage for the manifest and the built index (IndexedDB in the app, a Map in tests). */
export interface SnapshotStore {
  loadMeta(): Promise<SavedMeta | null>
  saveMeta(meta: SavedMeta): Promise<void>
  loadIndex(key: string): Promise<IndexParts | null>
  /** Replaces any other saved index. */
  saveIndex(key: string, parts: IndexParts): Promise<void>
}

export interface EngineEnv {
  fetch: typeof fetch
  /** Hex SHA-256, or null where it cannot be computed (crypto.subtle needs a secure context). */
  sha256: (data: ArrayBuffer) => Promise<string | null>
  sleep: (ms: number) => Promise<void>
  /** Lets queued messages (searches) run between slices of index building. */
  yieldNow: () => Promise<void>
  now: () => number
  store: SnapshotStore | null
  /** Waits between attempts; one attempt more than there are delays. */
  retryDelays?: readonly number[]
  /** A download that receives nothing for this long is aborted (and retried). */
  stallTimeoutMs?: number
  /** Longest stretch of index building between yields. */
  sliceMs?: number
  /** Delay before the snapshot is written (it blocks the worker while it is copied). */
  snapshotDelayMs?: number
  warn?: (...args: unknown[]) => void
  /** Timings worth seeing in the console (snapshot saved, index built). */
  info?: (...args: unknown[]) => void
}

const RETRY_DELAYS = [500, 1000, 2000, 4000]

class NotFound extends Error {}
class NoData extends Error {}

/** Said to the learner; the screens add how to build the data on a dev server (ui.tsx). */
const NO_DATA_MESSAGE = 'Chưa tải được dữ liệu từ điển: máy chủ chưa có hoặc đang cập nhật. Hãy thử lại sau ít phút.'
const LOAD_ERROR = 'Không tải được từ điển. Hãy kiểm tra kết nối mạng rồi thử lại.'
const REST_ERROR = 'Chưa tải được phần còn lại của từ điển (từ ít gặp). Hãy kiểm tra kết nối mạng rồi thử lại.'
const FORMAT_ERROR = 'Dữ liệu từ điển không đúng định dạng ứng dụng này đọc được. Hãy tải lại trang.'

interface StrokeList {
  /** Every character with stroke data, concatenated; null when the list could not be loaded. */
  text: string | null
  set: Set<string> | null
}

interface LoadedMeta {
  manifest: Manifest
  /**
   * The stroke availability list, as it arrives: loading does not wait for it (searches do not
   * need it), only the requests that report stroke data do.
   */
  strokes: Promise<StrokeList>
}

interface Waiter {
  full: boolean
  resolve: (index: DictIndex) => void
  reject: (e: Error) => void
}

export function parseManifest(text: string): Manifest {
  let m: Partial<Manifest>
  try {
    m = JSON.parse(text) as Partial<Manifest>
  } catch {
    throw new NoData('manifest is not JSON')
  }
  const ok =
    m.format === 1 &&
    typeof m.dataVersion === 'string' &&
    Array.isArray(m.shards) &&
    m.shards.length > 0 &&
    Array.isArray(m.columns) &&
    COLUMNS.every((c, i) => m.columns![i] === c) &&
    typeof m.strokes?.available === 'string'
  if (!ok) throw new Error(FORMAT_ERROR)
  let next = 0
  for (const s of m.shards!) {
    if (s.from !== next || s.to < s.from || typeof s.file !== 'string') throw new Error(FORMAT_ERROR)
    next = s.to + 1
  }
  return { hskWriting: {}, sources: [], ...m } as Manifest
}

export class DictEngine {
  private status: DictStatus = { state: 'idle', progress: 0 }
  private lastPost = 0
  private manifestUrl = ''
  private siteUrl = ''
  private meta: Promise<LoadedMeta> | null = null
  private strokeList: StrokeList | null = null
  private loading: Promise<void> | null = null
  private index: DictIndex | null = null
  private full = false
  private builder: IndexBuilder | null = null
  /** Next shard to add to `builder`. */
  private nextShard = 0
  private waiters: Waiter[] = []
  private pendingSearch: { id: number; q: string; limit: number } | null = null
  private searching = false
  private readonly retryDelays: readonly number[]
  private readonly stallMs: number
  private readonly sliceMs: number

  constructor(
    private readonly env: EngineEnv,
    private readonly post: (msg: FromWorker) => void,
  ) {
    this.retryDelays = env.retryDelays ?? RETRY_DELAYS
    this.stallMs = env.stallTimeoutMs ?? 20000
    this.sliceMs = env.sliceMs ?? 12
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'init':
        this.manifestUrl = msg.manifestUrl
        this.siteUrl = msg.siteUrl
        return
      case 'ensure':
        this.ensure()
        return
      case 'request':
        this.request(msg.id, msg.req)
        return
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  private setStatus(next: DictStatus, force = false): void {
    const prev = this.status
    this.status = next
    const now = this.env.now()
    // Progress alone is posted at most every 100 ms.
    if (force || prev.state !== next.state || prev.building !== next.building || now - this.lastPost >= 100) {
      this.lastPost = now
      this.post({ type: 'status', status: next })
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Starts loading, or tries again after a failure (no-data included: "Thử lại" asks for the manifest again). */
  private ensure(): void {
    if (this.loading || this.status.state === 'ready') return
    this.loading = this.load().finally(() => {
      this.loading = null
    })
  }

  private getMeta(): Promise<LoadedMeta> {
    this.meta ??= this.loadMeta().then(
      (m) => {
        void m.strokes.then((list) => (this.strokeList = list))
        return m
      },
      (e: unknown) => {
        this.meta = null
        throw e
      },
    )
    return this.meta
  }

  /** The stroke availability list, once it has come (or failed); null without a manifest. */
  private async strokesReady(): Promise<StrokeList | null> {
    const meta = await this.getMeta().catch(() => null)
    return meta ? (this.strokeList = await meta.strokes) : null
  }

  private async loadMeta(): Promise<LoadedMeta> {
    const saved = await this.safe(() => this.env.store?.loadMeta() ?? Promise.resolve(null))
    const usable = saved && saved.manifestUrl === this.manifestUrl ? saved : null
    let manifest: Manifest
    try {
      // Offline with a saved copy: one attempt, then the copy (no waiting through retries).
      const text = await this.fetchText(this.manifestUrl, 'no-cache', usable ? [] : this.retryDelays)
      manifest = parseManifest(text)
    } catch (e) {
      // Offline, or a page that is not the manifest (a Wi-Fi login page, a 404 during a deploy):
      // the copy saved on the last visit, when there is one.
      if (usable && !(e instanceof Error && e.message === FORMAT_ERROR)) {
        this.warn('[dict] manifest not loaded: using the saved one', e)
        return this.withAvailable(usable.manifest, usable.available)
      }
      if (e instanceof NotFound || e instanceof NoData) throw new NoData(NO_DATA_MESSAGE)
      throw e
    }
    // Not awaited: the core shard (or the snapshot) does not wait for the list. Named by its hash,
    // so the HTTP cache may answer without asking.
    const sameList = usable && usable.manifest.strokes.available === manifest.strokes.available ? usable.available : null
    const strokes = (sameList !== null ? Promise.resolve(sameList) : this.fetchText(new URL(manifest.strokes.available, this.siteUrl).href, 'force-cache', this.retryDelays))
      .catch((e: unknown) => {
        this.warn('[dict] stroke availability list not loaded', e)
        return null
      })
      .then((available) => {
        void this.safe(() => this.env.store?.saveMeta({ manifestUrl: this.manifestUrl, manifest, available }) ?? Promise.resolve())
        return available
      })
    return this.withAvailable(manifest, strokes)
  }

  private withAvailable(manifest: Manifest, text: string | null | Promise<string | null>): LoadedMeta {
    return { manifest, strokes: Promise.resolve(text).then((t) => ({ text: t, set: t === null ? null : new Set(t) })) }
  }

  private async load(): Promise<void> {
    let phase: 'core' | 'rest' = this.index ? 'rest' : 'core'
    try {
      const { manifest } = await this.getMeta()
      const dataVersion = manifest.dataVersion
      const snapKey = `${dataVersion}#${INDEX_FORMAT}`
      const [core, ...rest] = manifest.shards

      if (!this.index) {
        this.setStatus({ state: 'loading-core', progress: 0, dataVersion, loadedBytes: 0, totalBytes: core.bytes })
        const parts = await this.safe(() => this.env.store?.loadIndex(snapKey) ?? Promise.resolve(null))
        if (parts) {
          try {
            this.index = DictIndex.fromParts(parts)
            this.full = true
            this.setStatus({ state: 'ready', progress: 1, dataVersion, fromSnapshot: true }, true)
            this.flushWaiters()
            return
          } catch (e) {
            this.warn('[dict] snapshot unusable, rebuilding', e)
          }
        }
        const text = await this.fetchShard(core, (loaded) =>
          this.setStatus({ state: 'loading-core', progress: loaded / core.bytes, dataVersion, loadedBytes: loaded, totalBytes: core.bytes }),
        )
        this.setStatus({ state: 'loading-core', progress: 1, dataVersion, building: true })
        const t0 = this.env.now()
        this.builder = new IndexBuilder()
        await this.slices(this.builder.addShard(text, core.from))
        this.nextShard = 1
        this.index = await this.slices(this.builder.finish())
        this.env.info?.(`[dict] core: ${this.index.size} entries indexed in ${Math.round(this.env.now() - t0)} ms`)
        this.full = rest.length === 0
        this.setStatus({ state: this.full ? 'ready' : 'ready-core', progress: 1, dataVersion }, true)
        this.flushWaiters()
      }
      if (this.full || !this.builder) return
      phase = 'rest'

      const todo = manifest.shards.slice(this.nextShard)
      const total = todo.reduce((n, s) => n + s.bytes, 0)
      let done = 0
      const restStatus = (loaded: number) =>
        this.setStatus({ state: 'loading-rest', progress: total ? (done + loaded) / total : 1, dataVersion, loadedBytes: done + loaded, totalBytes: total })
      restStatus(0)
      // Download the next shard while the current one is being added.
      const fetchAt = (i: number) => {
        const p = this.fetchShard(todo[i], restStatus)
        p.catch(() => {})
        return p
      }
      let next = fetchAt(0)
      let busy = 0
      for (let i = 0; i < todo.length; i++) {
        const text = await next
        done += todo[i].bytes
        if (i + 1 < todo.length) next = fetchAt(i + 1)
        const t0 = this.env.now()
        await this.slices(this.builder.addShard(text, todo[i].from))
        busy += this.env.now() - t0
        this.nextShard++
      }
      this.setStatus({ state: 'loading-rest', progress: 1, dataVersion, building: true })
      const t1 = this.env.now()
      this.index = await this.slices(this.builder.finish())
      busy += this.env.now() - t1
      this.env.info?.(`[dict] all: ${this.index.size} entries indexed in ${Math.round(busy)} ms (rest added while downloading)`)
      this.full = true
      this.builder = null
      this.setStatus({ state: 'ready', progress: 1, dataVersion }, true)
      this.flushWaiters()
      this.saveSnapshotLater(snapKey)
    } catch (e) {
      const noData = e instanceof NoData
      const message = noData ? NO_DATA_MESSAGE : e instanceof Error && e.message === FORMAT_ERROR ? FORMAT_ERROR : phase === 'rest' ? REST_ERROR : LOAD_ERROR
      if (!noData) this.warn('[dict] load failed', e)
      if (phase === 'rest' && this.index) {
        // The core keeps working; ensure() retries the rest from the shard that failed.
        this.setStatus({ ...this.status, state: 'ready-core', progress: 0, building: false, error: message }, true)
        this.flushWaiters(new Error(message))
      } else {
        this.meta = null // the next attempt asks for the manifest again (the site may have been redeployed)
        this.setStatus({ state: noData ? 'no-data' : 'error', progress: 0, error: message }, true)
        this.flushWaiters(noData ? new NoData(message) : new Error(message))
      }
    }
  }

  private saveSnapshotLater(key: string): void {
    const store = this.env.store
    const index = this.index
    if (!store || !index) return
    void this.env.sleep(this.env.snapshotDelayMs ?? 3000).then(() =>
      this.safe(async () => {
        const t0 = this.env.now()
        await store.saveIndex(key, index.toParts())
        this.env.info?.(`[dict] snapshot saved in ${Math.round(this.env.now() - t0)} ms`)
      }),
    )
  }

  /** Runs a builder generator, yielding to queued messages every `sliceMs`. */
  private async slices<T>(gen: Generator<void, T>): Promise<T> {
    let t0 = this.env.now()
    for (;;) {
      const r = gen.next()
      if (r.done) return r.value
      if (this.env.now() - t0 >= this.sliceMs) {
        await this.env.yieldNow()
        t0 = this.env.now()
      }
    }
  }

  /** The index once it covers what is asked: the core (any index), or the whole dictionary. */
  private whenIndex(full: boolean): Promise<DictIndex> {
    if (this.index && (this.full || !full)) return Promise.resolve(this.index)
    if (this.status.state === 'no-data') return Promise.reject(new NoData(NO_DATA_MESSAGE))
    if (this.index && full && this.status.error) return Promise.resolve(this.index) // rest failed: answer from the core
    this.ensure()
    return new Promise((resolve, reject) => this.waiters.push({ full, resolve, reject }))
  }

  private flushWaiters(error?: Error): void {
    const keep: Waiter[] = []
    for (const w of this.waiters) {
      if (this.index && (this.full || !w.full || error)) w.resolve(this.index)
      else if (error) w.reject(error)
      else keep.push(w)
    }
    this.waiters = keep
  }

  // ── Network ────────────────────────────────────────────────────────────────

  private async fetchShard(shard: ShardInfo, onProgress: (loaded: number) => void): Promise<string> {
    const url = new URL(shard.file, this.manifestUrl).href
    return this.retry(async (attempt) => {
      const buf = await this.download(url, attempt ? 'reload' : 'default', onProgress)
      if (shard.bytes && buf.byteLength !== shard.bytes) throw new Error(`${shard.file}: ${buf.byteLength} bytes, expected ${shard.bytes}`)
      const hash = await this.env.sha256(buf)
      if (hash && shard.sha256 && hash !== shard.sha256.toLowerCase()) throw new Error(`${shard.file}: checksum mismatch`)
      return new TextDecoder().decode(buf)
    }, this.retryDelays)
  }

  /** A small file (manifest, availability list); an attempt that gets nothing for `stallMs` is aborted and retried. */
  private fetchText(url: string, cache: RequestCache, delays: readonly number[]): Promise<string> {
    return this.retry(async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.stallMs)
      try {
        const res = await this.env.fetch(url, { cache, signal: ctrl.signal })
        if (res.status === 404) throw new NotFound(url)
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
        // A static server's fallback page instead of the file: the file is not there.
        if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new NotFound(url)
        return await res.text()
      } finally {
        clearTimeout(timer)
      }
    }, delays)
  }

  /** The body, streamed for progress; aborted when nothing arrives for `stallMs`. */
  private async download(url: string, cache: RequestCache, onProgress: (loaded: number) => void): Promise<ArrayBuffer> {
    const ctrl = new AbortController()
    let timer = setTimeout(() => ctrl.abort(), this.stallMs)
    const bump = () => {
      clearTimeout(timer)
      timer = setTimeout(() => ctrl.abort(), this.stallMs)
    }
    try {
      const res = await this.env.fetch(url, { cache, signal: ctrl.signal })
      if (res.status === 404) throw new NotFound(url)
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) return await res.arrayBuffer()
      const chunks: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.byteLength
        bump()
        onProgress(loaded)
      }
      const out = new Uint8Array(loaded)
      let at = 0
      for (const c of chunks) {
        out.set(c, at)
        at += c.byteLength
      }
      return out.buffer
    } finally {
      clearTimeout(timer)
    }
  }

  private async retry<T>(fn: (attempt: number) => Promise<T>, delays: readonly number[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(attempt)
      } catch (e) {
        if (e instanceof NotFound || e instanceof NoData || attempt >= delays.length) throw e
        await this.env.sleep(delays[attempt])
      }
    }
  }

  private async safe<T>(fn: () => Promise<T> | undefined): Promise<T | null> {
    try {
      return (await fn()) ?? null
    } catch (e) {
      this.warn('[dict] storage', e)
      return null
    }
  }

  private warn(...args: unknown[]): void {
    this.env.warn?.(...args)
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  private reply(id: number, result: unknown): void {
    this.post({ type: 'reply', id, ok: true, result })
  }

  private fail(id: number, e: unknown): void {
    this.post({
      type: 'reply',
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      noData: e instanceof NoData || undefined,
    })
  }

  private request(id: number, req: Request): void {
    if (req.type === 'search') {
      if (this.pendingSearch) this.reply(this.pendingSearch.id, staleResult(this.pendingSearch.q))
      this.pendingSearch = { id, q: req.q, limit: req.limit }
      void this.runSearches()
      return
    }
    const run = async (): Promise<unknown> => {
      switch (req.type) {
        case 'meta':
          return this.metaReply()
        case 'entry':
          return this.entry(req.key)
        case 'word':
          return this.word(req.key)
        case 'charInfo':
          return this.charInfo(req.ch)
      }
    }
    run().then(
      (r) => this.reply(id, r),
      (e: unknown) => this.fail(id, e),
    )
  }

  /** Only the latest search runs; one that waited behind a newer one is answered as stale. */
  private async runSearches(): Promise<void> {
    if (this.searching) return
    this.searching = true
    try {
      while (this.pendingSearch) {
        await this.env.yieldNow()
        let index: DictIndex
        try {
          index = await this.whenIndex(false)
        } catch (e) {
          if (this.pendingSearch) this.fail(this.pendingSearch.id, e)
          this.pendingSearch = null
          break
        }
        const p = this.pendingSearch
        this.pendingSearch = null
        if (!p) break
        try {
          this.reply(p.id, this.search(index, p.q, p.limit))
        } catch (e) {
          this.fail(p.id, e)
        }
      }
    } finally {
      this.searching = false
    }
  }

  private search(index: DictIndex, q: string, limit: number): SearchResult {
    const t0 = this.env.now()
    const r = index.search(q, limit, 30)
    const entries = new Map<number, DictEntry>()
    const toHit = (h: RawHit): SearchHit => {
      let entry = entries.get(h.id)
      if (!entry) entries.set(h.id, (entry = index.entry(h.id)))
      return { entry, score: h.score, kind: h.kind, sense: h.sense, ...(h.lang ? { lang: h.lang } : {}) }
    }
    return {
      query: q,
      hits: r.hits.map(toHit),
      groups: r.groups?.map((g) => ({ kind: g.kind, hits: g.hits.map(toHit), total: g.total })) ?? null,
      partial: !this.full,
      stale: false,
      ms: this.env.now() - t0,
    }
  }

  private async metaReply(): Promise<MetaReply> {
    const { manifest, strokes } = await this.getMeta()
    const { text: availableText } = await strokes
    return {
      dataVersion: manifest.dataVersion,
      sources: manifest.sources,
      files: manifest.shards.map((s) => ({ name: s.file, url: new URL(s.file, this.manifestUrl).href, bytes: s.bytes })),
      licensesUrl: new URL('licenses/', this.siteUrl).href,
      hskWriting: manifest.hskWriting,
      available: availableText,
    }
  }

  private hasStrokes(ch: string): boolean {
    return this.strokeList?.set?.has(ch) ?? false
  }

  /** Found in the core, or else looked up again once everything is loaded. */
  private async lookup<T>(find: (index: DictIndex) => T | null): Promise<T | null> {
    const found = find(await this.whenIndex(false))
    if (found !== null || this.full) return found
    return find(await this.whenIndex(true))
  }

  private entry(key: string): Promise<DictEntry | null> {
    return this.lookup((index) => {
      const id = index.findKey(key)
      return id < 0 ? null : index.entry(id)
    })
  }

  private async charInfo(ch: string): Promise<CharInfo | null> {
    await this.strokesReady()
    return this.lookup((index) => charInfoOf(index, ch, this.hasStrokes(ch), !this.full))
  }

  private async word(key: string): Promise<WordDetail | null> {
    await this.strokesReady()
    return this.lookup((index) => {
      const id = index.findKey(key)
      if (id < 0) return null
      const entry = index.entry(id)
      const same = index.simpK.exact(entry.simp)
      const sameForm = same.filter((other) => other !== id).map((other) => index.entry(other))
      // Rows are in rank order: a more common row read otherwise means this is not the usual reading.
      const reading = entry.pinyin.toLowerCase()
      const usualReading = !same.some((other) => other < id && index.py[other].toLowerCase() !== reading)
      return {
        entry,
        chars: wordChars(index, entry, (c) => this.hasStrokes(c)),
        sameForm,
        usualReading,
        partial: !this.full,
      }
    })
  }
}

function staleResult(q: string): SearchResult {
  return { query: q, hits: [], groups: null, partial: false, stale: true, ms: 0 }
}

/** CharInfo from the single-character rows of `ch`. */
export function charInfoOf(index: DictIndex, ch: string, hasStrokes: boolean, partial: boolean): CharInfo | null {
  const ids = index.charRows(ch)
  if (!ids.length) return null
  let same = false
  let asSimp = false
  let asTrad = false
  const others: string[] = []
  for (const id of ids) {
    const f = index.row(id)
    const simp = f[COL.simp]
    const trad = f[COL.trad] || simp
    if (simp === trad) same = true
    else if (simp === ch) {
      asSimp = true
      others.push(trad)
    } else {
      asTrad = true
      others.push(simp)
    }
  }
  const script = same || (asSimp && asTrad) ? 'both' : asSimp ? 'simplified' : asTrad ? 'traditional' : 'both'
  const counterparts = [...new Set(others)]
  return {
    char: ch,
    script,
    counterpart: script === 'both' ? null : (counterparts[0] ?? null),
    counterparts,
    entries: ids.map((id) => index.entry(id)),
    hasStrokes,
    partial,
  }
}

/** The characters of a word with their reading in it, their Hán Việt, and their own entry. */
export function wordChars(index: DictIndex, entry: DictEntry, hasStrokes: (ch: string) => boolean): WordChar[] {
  const chars = [...entry.simp]
  const trads = [...entry.trad]
  const syllables = numberedSyllables(entry.pinyin)
  const rawSyllables = entry.pinyin.trim().split(/\s+/)
  const aligned = syllables.length === chars.length
  const hv = entry.hv && entry.hv !== '-' ? entry.hv.split(' ') : []
  const hvAligned = hv.length === chars.length
  const out: WordChar[] = []
  const seen = new Set<string>()
  chars.forEach((ch, i) => {
    if (seen.has(ch) || !hanChars(ch).length) return
    seen.add(ch)
    const s = aligned ? syllables[i] : null
    const reading = s ? `${s.letters.replace(/v/g, 'u:')}${s.tone || ''}` : ''
    // Its row in this word: the word's traditional form of it (发 in 頭髮 is 髮 "tóc"), its reading
    // here (tone, then any tone: 学生's sheng5 is 生 shēng) — see mainForm.ts.
    const rows = index.charRows(ch).map((id) => index.entry(id))
    const own = pickCharRow(rows, ch, {
      trad: trads.length === chars.length ? trads[i] : null,
      syllable: aligned ? (rawSyllables.length === chars.length ? rawSyllables[i] : reading) : null,
      exactCase: !entry.flags.includes('pn'),
    })
    out.push({
      char: ch,
      reading,
      hv: hvAligned ? hv[i] : own && own.hv !== '-' ? own.hv : '',
      entry: own,
      hasStrokes: hasStrokes(ch),
      trad: trads.length === chars.length && trads[i] !== ch ? trads[i] : null,
      tradHasStrokes: trads.length === chars.length && trads[i] !== ch && hasStrokes(trads[i]),
    })
  })
  return out
}
