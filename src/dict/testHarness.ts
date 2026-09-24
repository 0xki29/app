import availableTxt from './__fixtures__/available.txt?raw'
import coreTsv from './__fixtures__/core.tsv?raw'
import manifestJson from './__fixtures__/manifest.json?raw'
import restTsv from './__fixtures__/rest-1.tsv?raw'
import type { EngineEnv, SavedMeta, SnapshotStore } from './engine'
import type { IndexParts } from './searchIndex'

/**
 * Test-only helpers for the dictionary engine and client: the fixture served by a fake fetch
 * (with failures on demand), an in-memory snapshot store, and quick timers. The app never imports it.
 */

export const SITE = 'https://example.test/app/'
export const MANIFEST_URL = `${SITE}dict/v1/manifest.json`

const utf8 = (s: string) => new TextEncoder().encode(s)

/** The fixture shard texts, in order. */
export const FIXTURE_TEXTS = [coreTsv, restTsv]

export interface Served {
  status: number
  body: Uint8Array | string
  type?: string
}

export interface FakeNet {
  fetch: typeof fetch
  /** url → what to answer; a function is called per request (attempt number from 0). */
  routes: Map<string, Served | ((attempt: number) => Served | Promise<Served> | 'network-error')>
  calls: string[]
  count(suffix: string): number
}

export function fixtureRoutes(): FakeNet['routes'] {
  const routes: FakeNet['routes'] = new Map()
  routes.set(MANIFEST_URL, { status: 200, body: utf8(manifestJson), type: 'application/json' })
  routes.set(`${SITE}dict/v1/core.tsv`, { status: 200, body: utf8(coreTsv), type: 'text/tab-separated-values' })
  routes.set(`${SITE}dict/v1/rest-1.tsv`, { status: 200, body: utf8(restTsv), type: 'text/tab-separated-values' })
  routes.set(`${SITE}strokes/v2.0.1/available.txt`, { status: 200, body: utf8(availableTxt), type: 'text/plain' })
  return routes
}

export function fakeNet(routes = fixtureRoutes()): FakeNet {
  const calls: string[] = []
  const attempts = new Map<string, number>()
  const net: FakeNet = {
    routes,
    calls,
    count: (suffix) => calls.filter((u) => u.endsWith(suffix)).length,
    fetch: async (input) => {
      const url = String(input)
      calls.push(url)
      const n = attempts.get(url) ?? 0
      attempts.set(url, n + 1)
      const route = routes.get(url)
      const served = typeof route === 'function' ? await route(n) : route
      if (served === 'network-error') throw new TypeError('Failed to fetch')
      if (!served) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
      return new Response(served.body as BodyInit, {
        status: served.status,
        headers: { 'content-type': served.type ?? 'application/octet-stream' },
      })
    },
  }
  return net
}

export function memoryStore(): SnapshotStore & { meta: SavedMeta | null; index: Map<string, IndexParts> } {
  const store = {
    meta: null as SavedMeta | null,
    index: new Map<string, IndexParts>(),
    loadMeta: async () => store.meta,
    saveMeta: async (m: SavedMeta) => {
      store.meta = structuredClone(m)
    },
    loadIndex: async (key: string) => store.index.get(key) ?? null,
    saveIndex: async (key: string, parts: IndexParts) => {
      store.index.clear()
      store.index.set(key, structuredClone(parts))
    },
  }
  return store
}

export function testEnv(net: FakeNet, store: SnapshotStore | null, extra: Partial<EngineEnv> = {}): EngineEnv & { sleeps: number[] } {
  const sleeps: number[] = []
  return {
    fetch: net.fetch,
    sha256: async (data) => {
      const d = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
    },
    sleep: (ms) => {
      sleeps.push(ms)
      return new Promise((r) => setTimeout(r, 0))
    },
    yieldNow: () => new Promise((r) => setTimeout(r, 0)),
    now: () => performance.now(),
    store,
    snapshotDelayMs: 0,
    sleeps,
    ...extra,
  }
}

/** Resolves once `check` is true, polling on timers (the engine works on timers too). */
export async function until(check: () => boolean, what = 'condition', ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 1))
  }
}
