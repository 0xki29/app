import { useSyncExternalStore } from 'react'
import type { FromWorker, MetaReply, ReplyOf, Request, ToWorker, WordDetail } from './protocol'
import type { CharInfo, DictEntry, DictMeta, DictStatus, SearchResult } from './types'

/**
 * The dictionary as the page sees it: every call is a message to the dictionary worker (worker.ts)
 * with a request id; its status is a small store for React (useDictStatus). The worker starts on
 * the first call; nothing is downloaded until something needs the entries (ensureLoaded, search,
 * entry, charInfo, word). hasStrokes and hskWriting need only the manifest and the stroke list.
 *
 * Searches: debouncing is the screen's job. A reply to a search that is no longer the latest one
 * comes back with `stale: true` (the worker also skips searches overtaken while they waited).
 */

export interface Transport {
  post(msg: ToWorker): void
  close(): void
}

export type Connect = (onMessage: (msg: FromWorker) => void, onFailure: (message: string) => void) => Transport

export interface Dictionary {
  status(): DictStatus
  subscribe(cb: () => void): () => void
  /** Starts (or retries) loading the entries: core first, then the rest in the background. */
  ensureLoaded(): void
  search(q: string, limit?: number): Promise<SearchResult>
  entry(key: string): Promise<DictEntry | null>
  charInfo(ch: string): Promise<CharInfo | null>
  hskWriting(level: 1 | 2 | 3): Promise<string[]>
  hasStrokes(ch: string): Promise<boolean>
  /** An entry with its characters (reading, Hán Việt, own entry, stroke data) and its other readings. */
  word(key: string): Promise<WordDetail | null>
  /** Data version, sources and files, for the credits page (no entries loaded). */
  meta(): Promise<DictMeta>
}

/** A request the worker could not answer; `noData` when the data was never built (dev). */
export class DictError extends Error {
  constructor(
    message: string,
    readonly noData = false,
  ) {
    super(message)
    this.name = 'DictError'
  }
}

/** The worker failed to start (a script the site no longer has after a deploy, a crash): only a reload helps. */
export const WORKER_FAILED = 'Không khởi động được bộ tra từ điển. Hãy tải lại trang.'

export function createDictionary(connect: Connect, urls: () => { manifestUrl: string; siteUrl: string }): Dictionary {
  let transport: Transport | null = null
  let current: DictStatus = { state: 'idle', progress: 0 }
  const listeners = new Set<() => void>()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let nextId = 1
  let latestSearch = 0
  let metaPromise: Promise<MetaReply> | null = null
  let available: Set<string> | null = null

  const setStatus = (s: DictStatus) => {
    current = s
    for (const l of [...listeners]) l()
  }

  const onMessage = (msg: FromWorker) => {
    if (msg.type === 'status') {
      setStatus(msg.status)
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new DictError(msg.error, msg.noData))
  }

  // The worker failed to start or crashed: everything waiting fails, and the next call starts a new one.
  const onFailure = (message: string) => {
    transport?.close()
    transport = null
    metaPromise = null
    const waiting = [...pending.values()]
    pending.clear()
    for (const p of waiting) p.reject(new DictError(WORKER_FAILED))
    console.error('[dict] worker failed:', message)
    setStatus({ state: 'error', progress: 0, error: WORKER_FAILED })
  }

  const connection = (): Transport => {
    if (!transport) {
      transport = connect(onMessage, onFailure)
      transport.post({ type: 'init', ...urls() })
    }
    return transport
  }

  const request = <T extends Request['type']>(req: Extract<Request, { type: T }>): Promise<ReplyOf[T]> => {
    const id = nextId++
    if (req.type === 'search') latestSearch = id
    return new Promise<ReplyOf[T]>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      connection().post({ type: 'request', id, req })
    }).then((r) => (req.type === 'search' && id !== latestSearch ? ({ ...(r as SearchResult), stale: true } as ReplyOf[T]) : r))
  }

  const getMeta = (): Promise<MetaReply> => {
    metaPromise ??= request({ type: 'meta' }).then(
      (m) => {
        available = m.available === null ? null : new Set(m.available)
        return m
      },
      (e: unknown) => {
        metaPromise = null
        throw e
      },
    )
    return metaPromise
  }

  return {
    status: () => current,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    ensureLoaded() {
      connection().post({ type: 'ensure' })
    },
    search: (q, limit = 50) => request({ type: 'search', q, limit }),
    entry: (key) => request({ type: 'entry', key }),
    charInfo: (ch) => request({ type: 'charInfo', ch }),
    word: (key) => request({ type: 'word', key }),
    async hskWriting(level) {
      const m = await getMeta()
      return [...(m.hskWriting[String(level)] ?? [])]
    },
    async hasStrokes(ch) {
      await getMeta()
      if (!available) throw new DictError('Không tải được danh sách chữ có dữ liệu nét viết.')
      return available.has(ch)
    },
    async meta() {
      const { hskWriting: _h, available: _a, ...meta } = await getMeta()
      return meta
    },
  }
}

function connectWorker(onMessage: (msg: FromWorker) => void, onFailure: (message: string) => void): Transport {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dictionary' })
  worker.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data)
  worker.onerror = (e) => {
    e.preventDefault()
    onFailure(e.message || 'worker error')
  }
  worker.onmessageerror = () => onFailure('message could not be read')
  return { post: (msg) => worker.postMessage(msg), close: () => worker.terminate() }
}

/** The data lives next to the app: <site>/dict/v1/manifest.json (public/ in the repo). */
function siteUrls() {
  const siteUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href
  return { siteUrl, manifestUrl: new URL('dict/v1/manifest.json', siteUrl).href }
}

export const dictionary: Dictionary = createDictionary(connectWorker, siteUrls)

/** The dictionary's loading status; re-renders when it changes (progress at most every 100 ms). */
export function useDictStatus(): DictStatus {
  return useSyncExternalStore(dictionary.subscribe, dictionary.status)
}

/** True once searches are answered (the core at least). */
export function isSearchable(s: DictStatus): boolean {
  return s.state === 'ready-core' || s.state === 'loading-rest' || s.state === 'ready'
}
