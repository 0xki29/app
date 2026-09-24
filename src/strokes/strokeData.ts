import type { SourcePoint, StrokeData } from './types'

/**
 * Stroke-order data, fetched per character at run time: `strokes/v2.0.1/<code point in hex>.json`
 * next to the app, byte-for-byte hanzi-writer-data files that `npm run data:build` copies into
 * public/ (Arphic Public License; the build ships it under licenses/). Which characters have a file
 * is the manifest's availability list (public/dict/v1/manifest.json → strokes.available): once it
 * is in, a character without data costs no request and gets a clear "none". The first file asked
 * for does not wait for the list: both are fetched side by side, and a 404 means "none".
 *
 * fetch() with retries, never a dynamic import(): browsers keep a failed import for the life of
 * the page, so a network error could never be retried. Every attempt has a deadline (a request a
 * stalled connection never answers is aborted and retried like a network error). Results are
 * cached in memory: a character is fetched once per page (the files are versioned by path, so the
 * HTTP cache may keep them too). A failure is not cached — the next request (or retry()) fetches
 * again. The manifest is asked of the server every time (no-cache): one kept from before a deploy
 * would point to a stroke list the site no longer has.
 */

export type StrokeStatus = 'loading' | 'ready' | 'none' | 'error'

/** One character's stroke data as the UI sees it. `data` is set only when `status` is 'ready'. */
export interface StrokeEntry {
  readonly status: StrokeStatus
  readonly data: StrokeData | null
}

/** What the app reads from the data manifest. */
export interface SiteData {
  dataVersion: string
  /** Absolute URL of the folder with the stroke files (ends with '/'). */
  strokesBase: string
  /** Absolute URL of the availability list. */
  listUrl: string
  /** HSK 3.0 writing lists by level ('1'–'3'), in the order they are offered (most frequent first). */
  hskWriting: Readonly<Record<string, readonly string[]>>
  /** Level-1 characters → the word a quick-added card is learned in: [entry key, first meaning, proper noun]. */
  hskContext: Readonly<Record<string, readonly [string, string, boolean?]>>
}

/** The data manifest or the stroke list could not be loaded (network, or a site mid-deploy): said to the learner as is. */
export class DataUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Chưa tải được dữ liệu của ứng dụng. Hãy kiểm tra kết nối mạng rồi thử lại.', { cause })
    this.name = 'DataUnavailableError'
  }
}

export interface StrokeSourceEnv {
  /** Absolute URL of the site root (where index.html is), ending with '/'. */
  siteUrl: () => string
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  /** Waits before each retry of a failed request; its length is the number of retries. */
  retryDelays?: readonly number[]
  /** An attempt that has not got its whole answer by then is aborted (and retried). */
  timeoutMs?: number
  warn?: (...args: unknown[]) => void
}

export interface StrokeSource {
  /** The manifest's data, or null when the data was never built (dev without `npm run data:build`). Rejects (DataUnavailableError) on network failure. */
  siteData(): Promise<SiteData | null>
  /** Whether `char` has stroke data (false without data). Rejects (DataUnavailableError) when the manifest or the list cannot be loaded. */
  has(char: string): Promise<boolean>
  /** The stroke data for `char`, or null when it has none. Rejects on network failure (not cached). */
  load(char: string): Promise<StrokeData | null>
  /** The current state for `char`: 'loading' until a load settles (also before one starts). Same object until it changes. */
  entry(char: string): StrokeEntry
  /** Starts loading `char` unless it is loaded or loading (an earlier failure is tried again). */
  ensure(char: string): void
  /** Loads `char` again after a failure. */
  retry(char: string): void
  /** Called whenever an entry changes. */
  subscribe(listener: () => void): () => void
}

export const MANIFEST_PATH = 'dict/v1/manifest.json'
const RETRY_DELAYS = [500, 1000, 2000]
/** Per attempt, the body included: a stroke file is 1–10 KB, the list 20 KB gzip. */
const TIMEOUT_MS = 15_000

const LOADING: StrokeEntry = Object.freeze({ status: 'loading', data: null })
const NONE: StrokeEntry = Object.freeze({ status: 'none', data: null })
const FAILED: StrokeEntry = Object.freeze({ status: 'error', data: null })

/** A request that failed in a way a retry cannot fix (a 4xx other than 404). */
class PermanentError extends Error {}

export function createStrokeSource(env: StrokeSourceEnv): StrokeSource {
  const delays = env.retryDelays ?? RETRY_DELAYS
  const timeoutMs = env.timeoutMs ?? TIMEOUT_MS
  const warn = env.warn ?? ((...args: unknown[]) => console.warn(...args))
  const entries = new Map<string, StrokeEntry>()
  const pending = new Map<string, Promise<StrokeData | null>>()
  const listeners = new Set<() => void>()
  let site: Promise<SiteData | null> | null = null
  let list: Promise<ReadonlySet<string> | null> | null = null
  /** The availability list, once it is in. */
  let known: ReadonlySet<string> | null = null

  const set = (char: string, entry: StrokeEntry) => {
    if (entries.get(char) === entry) return
    entries.set(char, entry)
    for (const l of [...listeners]) l()
  }

  /**
   * `read(response)`, or null for a file that is not there (404); retries network errors, 5xx and
   * attempts that time out (the deadline covers reading the body too).
   */
  async function get<T>(url: string, init: RequestInit, read: (res: Response) => Promise<T>): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      let failure: unknown
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(new Error(`no answer in ${timeoutMs} ms: ${url}`)), timeoutMs)
      try {
        const res = await env.fetch(url, { ...init, signal: ctrl.signal })
        if (res.ok) return await read(res)
        if (res.status === 404 || res.status === 410) return null
        failure = new Error(`HTTP ${res.status} for ${url}`)
        if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentError(String(failure))
      } catch (err) {
        if (err instanceof PermanentError) throw err
        failure = err
      } finally {
        clearTimeout(timer)
      }
      if (attempt >= delays.length) throw failure
      await env.sleep(delays[attempt])
    }
  }

  async function loadSite(): Promise<SiteData | null> {
    const base = env.siteUrl()
    const json = await get(new URL(MANIFEST_PATH, base).href, { cache: 'no-cache' }, async (res) =>
      // A dev server answers a missing file with its index.html.
      (res.headers.get('content-type') ?? '').includes('html') ? null : ((await res.json()) as unknown),
    )
    if (json === null) {
      warn('[strokes] no data manifest: characters show the font glyph. Run `npm run data:build`.')
      return null
    }
    const manifest = parseManifest(json)
    if (!manifest) {
      warn('[strokes] the data manifest has no stroke section: characters show the font glyph.')
      return null
    }
    return {
      dataVersion: manifest.dataVersion,
      strokesBase: new URL(manifest.base, base).href,
      listUrl: new URL(manifest.available, base).href,
      hskWriting: manifest.hskWriting,
      hskContext: manifest.hskContext,
    }
  }

  function siteData(): Promise<SiteData | null> {
    site ??= loadSite().catch((err: unknown) => {
      site = null
      throw err instanceof DataUnavailableError ? err : new DataUnavailableError(err)
    })
    return site
  }

  /**
   * The availability list (null without a data build). A list the manifest names but the site does
   * not have is an error, not "no strokes": a quick-add would otherwise skip every character.
   */
  function available(): Promise<ReadonlySet<string> | null> {
    list ??= siteData()
      .then(async (data) => {
        if (!data) return null
        // The list is named by its hash: it never changes under the same URL.
        const text = await get(data.listUrl, { cache: 'force-cache' }, (res) => res.text())
        if (text === null) throw new Error(`the stroke availability list is missing: ${data.listUrl}`)
        return (known = new Set([...text.trim()]))
      })
      .catch((err: unknown) => {
        list = null
        throw err instanceof DataUnavailableError ? err : new DataUnavailableError(err)
      })
    return list
  }

  async function fetchChar(char: string): Promise<StrokeData | null> {
    const data = await siteData()
    if (!data) return null
    if (known && !known.has(char)) return null
    // Versioned folder: a file never changes under its URL. Until the list is in, the file is asked
    // for beside it (it is what the learner waits for), and a 404 means the character has none.
    const url = `${data.strokesBase}${charHex(char)}.json`
    const [set, json] = await Promise.all([
      known ?? available().catch(() => null),
      get(url, { cache: 'force-cache' }, (res) => res.json() as Promise<unknown>),
    ])
    if (json === null) {
      if (set?.has(char)) warn(`[strokes] ${char} is listed as available but its file is missing`)
      return null
    }
    const parsed = parseStrokeData(json)
    if (!parsed) warn(`[strokes] invalid stroke data for ${char}`)
    return parsed
  }

  function load(char: string): Promise<StrokeData | null> {
    if (!isOneChar(char)) return Promise.resolve(null)
    const known = entries.get(char)
    if (known?.status === 'ready' || known?.status === 'none') return Promise.resolve(known.data)
    let p = pending.get(char)
    if (!p) {
      p = fetchChar(char).then(
        (data) => {
          pending.delete(char)
          set(char, data ? { status: 'ready', data } : NONE)
          return data
        },
        (err: unknown) => {
          pending.delete(char)
          set(char, FAILED)
          throw err
        },
      )
      pending.set(char, p)
      set(char, LOADING)
    }
    return p
  }

  const quietly = (char: string) => {
    load(char).catch((err: unknown) => warn(`[strokes] could not load ${char}`, err))
  }

  return {
    siteData,
    async has(char) {
      const set = await available()
      return set !== null && set.has(char)
    },
    load,
    entry: (char) => (isOneChar(char) ? (entries.get(char) ?? LOADING) : NONE),
    ensure(char) {
      const e = entries.get(char)
      if (e?.status === 'ready' || e?.status === 'none' || pending.has(char)) return
      quietly(char)
    },
    retry(char) {
      if (entries.get(char)?.status === 'error') quietly(char)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Lowercase hex code point: the stroke file's name and the practice route's (学 → '5b66'). */
export function charHex(char: string): string {
  return (char.codePointAt(0) ?? 0).toString(16)
}

function isOneChar(s: string): boolean {
  return s.length > 0 && s.length <= 2 && [...s].length === 1
}

function parseManifest(json: unknown): {
  dataVersion: string
  base: string
  available: string
  hskWriting: Record<string, string[]>
  hskContext: Record<string, [string, string, boolean?]>
} | null {
  if (typeof json !== 'object' || json === null) return null
  const m = json as { dataVersion?: unknown; strokes?: { base?: unknown; available?: unknown }; hskWriting?: unknown; hskContext?: unknown }
  if (typeof m.strokes?.base !== 'string' || typeof m.strokes.available !== 'string') return null
  const hskWriting: Record<string, string[]> = {}
  if (typeof m.hskWriting === 'object' && m.hskWriting !== null) {
    for (const [level, chars] of Object.entries(m.hskWriting as Record<string, unknown>)) {
      if (Array.isArray(chars)) hskWriting[level] = chars.filter((c): c is string => typeof c === 'string')
    }
  }
  const hskContext: Record<string, [string, string, boolean?]> = {}
  if (typeof m.hskContext === 'object' && m.hskContext !== null) {
    for (const [char, v] of Object.entries(m.hskContext as Record<string, unknown>)) {
      if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') hskContext[char] = v[2] === true ? [v[0], v[1], true] : [v[0], v[1]]
    }
  }
  return {
    dataVersion: typeof m.dataVersion === 'string' ? m.dataVersion : '',
    base: m.strokes.base.endsWith('/') ? m.strokes.base : `${m.strokes.base}/`,
    available: m.strokes.available,
    hskWriting,
    hskContext,
  }
}

/** Validates raw JSON; `null` if it is not usable stroke data. */
export function parseStrokeData(json: unknown): StrokeData | null {
  if (typeof json !== 'object' || json === null) return null
  const { strokes, medians, radStrokes } = json as Record<string, unknown>
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return null
  if (strokes.length === 0 || strokes.length !== medians.length) return null
  if (!strokes.every((s) => typeof s === 'string' && s.length > 0)) return null
  const parsedMedians: SourcePoint[][] = []
  for (const median of medians) {
    if (!Array.isArray(median) || median.length < 2) return null
    const points: SourcePoint[] = []
    for (const p of median) {
      if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
      points.push([p[0] as number, p[1] as number])
    }
    parsedMedians.push(points)
  }
  const rad =
    Array.isArray(radStrokes) && radStrokes.every((i) => Number.isInteger(i)) ? (radStrokes as number[]) : undefined
  return { strokes: strokes as string[], medians: parsedMedians, radStrokes: rad }
}

/** The site's root URL: the data lives next to index.html (any sub-path, relative asset URLs). */
function siteUrl(): string {
  return new URL(import.meta.env.BASE_URL, document.baseURI).href
}

/** The app's stroke source (created lazily per call: nothing is fetched until a character is asked for). */
export const strokeSource: StrokeSource = createStrokeSource({
  siteUrl,
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/** The stroke data for `character`, or null if it has none; rejects on a network failure. */
export function getStrokeData(character: string): Promise<StrokeData | null> {
  return strokeSource.load(character)
}

/** Whether `character` has stroke data (the manifest's availability list). Rejects (DataUnavailableError) on a network failure. */
export function hasStrokeData(character: string): Promise<boolean> {
  return strokeSource.has(character)
}

/** The manifest's data (null without a data build). Rejects (DataUnavailableError) on a network failure. */
export function loadSiteData(): Promise<SiteData | null> {
  return strokeSource.siteData()
}
