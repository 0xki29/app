import { describe, expect, it } from 'vitest'
import { DictEngine, parseManifest } from './engine'
import type { FromWorker, MetaReply, Request, WordDetail } from './protocol'
import {
  fakeNet,
  fixtureRoutes,
  MANIFEST_URL,
  memoryStore,
  SITE,
  testEnv,
  until,
  type FakeNet,
} from './testHarness'
import type { CharInfo, DictEntry, DictState, DictStatus, SearchResult } from './types'
import type { SnapshotStore } from './engine'

type Reply = Extract<FromWorker, { type: 'reply' }>

/** An engine as the worker runs it, with a way to send requests and read replies and statuses. */
function start(net: FakeNet = fakeNet(), store: SnapshotStore | null = memoryStore(), extra = {}) {
  const statuses: DictStatus[] = []
  const replies = new Map<number, Reply>()
  const env = testEnv(net, store, extra)
  const engine = new DictEngine(env, (msg) => {
    if (msg.type === 'status') statuses.push(msg.status)
    else replies.set(msg.id, msg)
  })
  engine.handle({ type: 'init', manifestUrl: MANIFEST_URL, siteUrl: SITE })
  let nextId = 1
  const send = (req: Request) => {
    const id = nextId++
    engine.handle({ type: 'request', id, req })
    return id
  }
  const ask = async <T,>(req: Request): Promise<T> => {
    const id = send(req)
    await until(() => replies.has(id), `reply to ${req.type}`)
    const r = replies.get(id)!
    if (!r.ok) throw Object.assign(new Error(r.error), { noData: r.noData })
    return r.result as T
  }
  const state = () => statuses.at(-1)?.state ?? 'idle'
  const reach = (s: DictState) => until(() => state() === s, `state ${s}`)
  return { engine, env, net, store, statuses, replies, send, ask, state, reach }
}

const simps = (r: SearchResult) => r.hits.map((h) => h.entry.simp)

describe('loading', () => {
  it('loads the core, then the rest, and reports each step', async () => {
    const t = start()
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    const states = t.statuses.map((s) => s.state)
    expect(states).toEqual(expect.arrayContaining(['loading-core', 'ready-core', 'loading-rest', 'ready']))
    expect(states.indexOf('ready-core')).toBeLessThan(states.indexOf('loading-rest'))
    expect(t.statuses.at(-1)?.dataVersion).toBe('fixture-1')
    const r = await t.ask<SearchResult>({ type: 'search', q: 'hoc sinh', limit: 10 })
    expect(r.hits[0].entry.simp).toBe('学生')
    expect(r.partial).toBe(false)
    expect(r.stale).toBe(false)
    expect(t.net.count('core.tsv')).toBe(1)
    expect(t.net.count('rest-1.tsv')).toBe(1)
  })

  it('answers from the core while the rest is still downloading', async () => {
    const routes = fixtureRoutes()
    const rest = routes.get(`${SITE}dict/v1/rest-1.tsv`)!
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    routes.set(`${SITE}dict/v1/rest-1.tsv`, async () => {
      await gate
      return rest as Exclude<typeof rest, (n: number) => unknown>
    })
    const t = start(fakeNet(routes))
    const r1 = await t.ask<SearchResult>({ type: 'search', q: '行', limit: 10 })
    expect(r1.partial).toBe(true)
    expect(r1.hits.map((h) => h.entry.pinyin)).not.toContain('heng2') // that row is in the rest
    expect(t.state()).toBe('loading-rest')
    release()
    await t.reach('ready')
    const r2 = await t.ask<SearchResult>({ type: 'search', q: '行', limit: 10 })
    expect(r2.partial).toBe(false)
    expect(r2.hits.map((h) => h.entry.pinyin)).toContain('heng2')
  })

  it('is no-data when the manifest is missing (the data was never built)', async () => {
    const routes = fixtureRoutes()
    routes.delete(MANIFEST_URL)
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('no-data')
    // Said to the learner (the screens add the build command on a dev server only).
    expect(t.statuses.at(-1)?.error).toMatch(/^Chưa tải được dữ liệu từ điển/)
    expect(t.statuses.at(-1)?.error).not.toMatch(/npm/)
    await expect(t.ask({ type: 'search', q: 'an', limit: 5 })).rejects.toMatchObject({ noData: true })
    await expect(t.ask({ type: 'meta' })).rejects.toMatchObject({ noData: true })
    // no retries for a 404
    expect(t.net.count('manifest.json')).toBe(2)
    expect(t.env.sleeps).toEqual([])
  })

  it('is no-data when a static server answers with its HTML page instead', async () => {
    const routes = fixtureRoutes()
    routes.set(MANIFEST_URL, { status: 200, body: '<!doctype html><html></html>', type: 'text/html' })
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('no-data')
  })

  it('retries a failed download with backoff', async () => {
    const routes = fixtureRoutes()
    const core = routes.get(`${SITE}dict/v1/core.tsv`)!
    routes.set(`${SITE}dict/v1/core.tsv`, (n) => (n < 2 ? { status: 503, body: 'busy' } : (core as never)))
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    expect(t.env.sleeps.filter((ms) => ms > 0)).toEqual([500, 1000])
    expect(t.net.count('core.tsv')).toBe(3)
  })

  it('rejects a corrupted shard (checksum), gives up after 5 attempts, and can try again', async () => {
    const routes = fixtureRoutes()
    const core = routes.get(`${SITE}dict/v1/core.tsv`)! as { body: Uint8Array }
    const bad = core.body.slice()
    bad[10] ^= 1
    let broken = true
    routes.set(`${SITE}dict/v1/core.tsv`, () => ({ status: 200, body: broken ? bad : core.body }))
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('error')
    expect(t.net.count('core.tsv')).toBe(5)
    expect(t.env.sleeps).toEqual([500, 1000, 2000, 4000])
    expect(t.statuses.at(-1)?.error).toMatch(/kết nối mạng/)
    broken = false
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
  })

  it('keeps the core usable when the rest fails, and retries the rest on ensure', async () => {
    const routes = fixtureRoutes()
    const rest = routes.get(`${SITE}dict/v1/rest-1.tsv`)!
    let down = true
    routes.set(`${SITE}dict/v1/rest-1.tsv`, () => (down ? 'network-error' : (rest as never)))
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await until(() => t.statuses.at(-1)?.state === 'ready-core' && !!t.statuses.at(-1)?.error, 'rest error')
    const r = await t.ask<SearchResult>({ type: 'search', q: 'xuesheng', limit: 5 })
    expect(r.hits[0].entry.simp).toBe('学生')
    // an entry that is only in the rest: answered (null) rather than waiting forever
    expect(await t.ask<DictEntry | null>({ type: 'entry', key: '行|行[heng2]' })).toBeNull()
    down = false
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    expect((await t.ask<DictEntry | null>({ type: 'entry', key: '行|行[heng2]' }))?.pinyin).toBe('heng2')
  })

  it('aborts a download that stalls, then retries it', async () => {
    const routes = fixtureRoutes()
    const core = routes.get(`${SITE}dict/v1/core.tsv`)! as { body: Uint8Array }
    const t = start(
      fakeNet(routes),
      memoryStore(),
      { stallTimeoutMs: 30 },
    )
    let first = true
    const realFetch = t.env.fetch
    t.env.fetch = async (input, init) => {
      if (String(input).endsWith('core.tsv') && first) {
        first = false
        // a body that sends one chunk, then nothing
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(core.body.slice(0, 100))
            init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
          },
        })
        return new Response(body, { status: 200 })
      }
      return realFetch(input, init)
    }
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    expect(t.env.sleeps[0]).toBe(500)
  })

  it('aborts a manifest request that never answers, then retries it', async () => {
    const t = start(fakeNet(), memoryStore(), { stallTimeoutMs: 30 })
    let first = true
    const realFetch = t.env.fetch
    t.env.fetch = async (input, init) => {
      if (String(input).endsWith('manifest.json') && first) {
        first = false
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      return realFetch(input, init)
    }
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    expect(t.env.sleeps[0]).toBe(500)
  })

  it('does not wait for the stroke availability list: the core loads while it is still coming', async () => {
    const routes = fixtureRoutes()
    const list = routes.get(`${SITE}strokes/v2.0.1/available.txt`)!
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    routes.set(`${SITE}strokes/v2.0.1/available.txt`, async () => {
      await gate
      return list as Exclude<typeof list, (n: number) => unknown>
    })
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    const r = await t.ask<SearchResult>({ type: 'search', q: 'xuesheng', limit: 5 })
    expect(r.hits[0].entry.simp).toBe('学生')
    // What reports stroke data waits for the list.
    const id = t.send({ type: 'charInfo', ch: '学' })
    await new Promise((r) => setTimeout(r, 20))
    expect(t.replies.has(id)).toBe(false)
    release()
    await until(() => t.replies.has(id), 'charInfo')
    expect((t.replies.get(id) as Extract<Reply, { ok: true }>).result).toMatchObject({ hasStrokes: true })
  })

  it('tries again after no-data when asked (the learner presses "Thử lại")', async () => {
    const routes = fixtureRoutes()
    const manifest = routes.get(MANIFEST_URL)!
    routes.delete(MANIFEST_URL)
    const t = start(fakeNet(routes))
    t.engine.handle({ type: 'ensure' })
    await t.reach('no-data')
    routes.set(MANIFEST_URL, manifest)
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
  })
})

describe('snapshot', () => {
  it('saves the built index and starts from it next time, without downloading', async () => {
    const store = memoryStore()
    const t1 = start(fakeNet(), store)
    t1.engine.handle({ type: 'ensure' })
    await t1.reach('ready')
    await until(() => store.index.size === 1, 'snapshot saved')
    expect([...store.index.keys()][0]).toMatch(/^fixture-1#/)

    const t2 = start(fakeNet(), store)
    t2.engine.handle({ type: 'ensure' })
    await t2.reach('ready')
    expect(t2.statuses.at(-1)?.fromSnapshot).toBe(true)
    expect(t2.net.count('.tsv')).toBe(0)
    const r = await t2.ask<SearchResult>({ type: 'search', q: 'cảm ơn', limit: 5 })
    expect(r.hits[0].entry.simp).toBe('谢谢')
  })

  it('starts offline from the saved manifest and snapshot', async () => {
    const store = memoryStore()
    const t1 = start(fakeNet(), store)
    t1.engine.handle({ type: 'ensure' })
    await until(() => store.index.size === 1, 'snapshot saved')

    const offline = fakeNet(new Map())
    offline.fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const t2 = start(offline, store)
    t2.engine.handle({ type: 'ensure' })
    await t2.reach('ready')
    expect(t2.env.sleeps).toEqual([]) // no waiting through retries when a saved copy exists
    expect(await t2.ask<boolean>({ type: 'charInfo', ch: '学' })).toMatchObject({ hasStrokes: true })
  })

  it('starts from the saved manifest when the site answers with a page that is not it (Wi-Fi login, 404)', async () => {
    const store = memoryStore()
    const t1 = start(fakeNet(), store)
    t1.engine.handle({ type: 'ensure' })
    await until(() => store.index.size === 1, 'snapshot saved')

    for (const served of [
      { status: 200, body: '<!doctype html><title>Login</title>', type: 'text/html' },
      { status: 404, body: 'not found' },
    ]) {
      const routes = fixtureRoutes()
      routes.set(MANIFEST_URL, served)
      const t2 = start(fakeNet(routes), store)
      t2.engine.handle({ type: 'ensure' })
      await t2.reach('ready')
      expect(t2.statuses.at(-1)?.fromSnapshot).toBe(true)
    }
  })

  it('ignores a snapshot of another data version', async () => {
    const store = memoryStore()
    store.index.set('old#1', {} as never)
    const t = start(fakeNet(), store)
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
    expect(t.statuses.at(-1)?.fromSnapshot).toBeUndefined()
  })

  it('works without storage (private browsing)', async () => {
    const broken: SnapshotStore = {
      loadMeta: () => Promise.reject(new Error('denied')),
      saveMeta: () => Promise.reject(new Error('denied')),
      loadIndex: () => Promise.reject(new Error('denied')),
      saveIndex: () => Promise.reject(new Error('denied')),
    }
    const t = start(fakeNet(), broken)
    t.engine.handle({ type: 'ensure' })
    await t.reach('ready')
  })
})

describe('requests', () => {
  it('answers only the latest of searches that queued up; the others are stale', async () => {
    const t = start()
    const a = t.send({ type: 'search', q: 'x', limit: 5 })
    const b = t.send({ type: 'search', q: 'xu', limit: 5 })
    const c = t.send({ type: 'search', q: 'xuesheng', limit: 5 })
    await until(() => t.replies.has(c), 'last search')
    const result = (id: number) => (t.replies.get(id) as Extract<Reply, { ok: true }>).result as SearchResult
    expect(result(a).stale).toBe(true)
    expect(result(b).stale).toBe(true)
    expect(result(c).stale).toBe(false)
    expect(simps(result(c))[0]).toBe('学生')
  })

  it('gives meta (sources, files, stroke list, HSK lists) without loading the entries', async () => {
    const t = start()
    const m = await t.ask<MetaReply>({ type: 'meta' })
    expect(m.dataVersion).toBe('fixture-1')
    expect(m.files.map((f) => f.url)).toEqual([`${SITE}dict/v1/core.tsv`, `${SITE}dict/v1/rest-1.tsv`])
    expect(m.licensesUrl).toBe(`${SITE}licenses/`)
    expect(m.available).toContain('学')
    expect(m.hskWriting['1'].length).toBeGreaterThan(0)
    expect(m.sources[0].license).toBe('CC BY-SA 4.0')
    expect(t.net.count('.tsv')).toBe(0)
    expect(t.state()).toBe('idle')
  })

  it('describes a character: script, counterpart, readings, stroke data', async () => {
    const t = start()
    const xue = await t.ask<CharInfo>({ type: 'charInfo', ch: '学' })
    expect(xue).toMatchObject({ char: '学', script: 'simplified', counterpart: '學', hasStrokes: true })
    expect(xue.entries[0].pinyin).toBe('xue2')
    const trad = await t.ask<CharInfo>({ type: 'charInfo', ch: '學' })
    expect(trad).toMatchObject({ script: 'traditional', counterpart: '学' })
    const xing = await t.ask<CharInfo>({ type: 'charInfo', ch: '行' })
    expect(xing.script).toBe('both')
    expect(xing.counterpart).toBeNull()
    expect(xing.entries.map((e) => e.pinyin).slice(0, 2)).toEqual(['xing2', 'hang2'])
    const gan = await t.ask<CharInfo>({ type: 'charInfo', ch: '干' })
    expect(gan.script).toBe('both')
    expect(gan.counterparts).toEqual(expect.arrayContaining(['乾', '幹']))
    expect((await t.ask<CharInfo>({ type: 'charInfo', ch: '呣' }))?.hasStrokes).toBe(false)
    expect(await t.ask({ type: 'charInfo', ch: 'x' })).toBeNull()
  })

  it('details a word: each character with its reading in the word and its own entry', async () => {
    const t = start()
    const w = (await t.ask<WordDetail>({ type: 'word', key: '銀行|银行[yin2 hang2]' }))!
    expect(w.entry.hv).toBe('ngân hàng')
    expect(w.chars.map((c) => [c.char, c.reading, c.hv, c.entry?.pinyin])).toEqual([
      ['银', 'yin2', 'ngân', undefined], // 银 alone is not in the fixture
      ['行', 'hang2', 'hàng', 'hang2'], // not the more common xing2
    ])
    const xs = (await t.ask<WordDetail>({ type: 'word', key: '學生|学生[xue2 sheng5]' }))!
    expect(xs.chars[1]).toMatchObject({ char: '生', reading: 'sheng5' })
    expect(xs.chars[1].entry?.pinyin).toBe('sheng1') // the neutral tone in the word, its own tone alone
    // 谢谢: one card for the repeated character
    expect((await t.ask<WordDetail>({ type: 'word', key: '謝謝|谢谢[xie4 xie5]' }))!.chars.map((c) => c.char)).toEqual(['谢'])
    // a single character lists its other readings
    const hang = (await t.ask<WordDetail>({ type: 'word', key: '行|行[hang2]' }))!
    expect(hang.sameForm.map((e) => e.pinyin)).toEqual(expect.arrayContaining(['xing2', 'heng2']))
    // háng is not how 行 alone is usually read (a voice would say xíng); xíng is
    expect(hang.usualReading).toBe(false)
    expect((await t.ask<WordDetail>({ type: 'word', key: '行|行[xing2]' }))!.usualReading).toBe(true)
    expect(await t.ask({ type: 'word', key: '無|无[wu2 wu2 wu2]' })).toBeNull()
  })
})

describe('parseManifest', () => {
  it('checks the format, columns and shard ranges', () => {
    const ok = {
      format: 1,
      dataVersion: 'v',
      columns: ['simp', 'trad', 'pinyin', 'hv', 'hvAlt', 'vi', 'en', 'hsk', 'pop', 'flags'],
      shards: [{ file: 'a', from: 0, to: 9, bytes: 1, sha256: '' }],
      strokes: { base: 's/', available: 's/a.txt' },
      hskWriting: {},
      sources: [],
    }
    expect(parseManifest(JSON.stringify(ok)).dataVersion).toBe('v')
    expect(() => parseManifest(JSON.stringify({ ...ok, format: 2 }))).toThrow()
    expect(() => parseManifest(JSON.stringify({ ...ok, columns: ['simp'] }))).toThrow()
    expect(() => parseManifest(JSON.stringify({ ...ok, shards: [{ ...ok.shards[0], from: 1 }] }))).toThrow()
    expect(() => parseManifest('<html>')).toThrow()
  })
})
