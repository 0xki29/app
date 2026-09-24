import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_STROKE_FILES, fixtureStrokeData } from '../test/fixtures/strokes'
import { TEST_CHARS } from '../test/fixtures/testChars'
import { createStrokeSource, DataUnavailableError, parseStrokeData, type StrokeSourceEnv } from './strokeData'

const SITE = 'https://example.test/app/'
const YONG = FIXTURE_STROKE_FILES['./strokes/6c38.json']

type Answer = { status: number; body?: unknown; type?: string } | 'network-error'

/** A fake network: url → answer (a function gets the attempt number). Records every request. */
function net(routes: Record<string, Answer | ((attempt: number) => Answer)>) {
  const calls: string[] = []
  const inits: (RequestInit | undefined)[] = []
  const attempts = new Map<string, number>()
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url)
    inits.push(init)
    const n = attempts.get(url) ?? 0
    attempts.set(url, n + 1)
    const route = routes[url]
    const answer = typeof route === 'function' ? route(n) : (route ?? { status: 404 })
    if (answer === 'network-error') throw new TypeError('Failed to fetch')
    const body = answer.body === undefined ? '' : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)
    return new Response(answer.status === 204 ? null : body, {
      status: answer.status,
      headers: { 'content-type': answer.type ?? 'application/json' },
    })
  })
  return { fetch, calls, inits }
}

const MANIFEST = {
  format: 1,
  dataVersion: 'test-1',
  strokes: { base: 'strokes/v2.0.1/', available: 'strokes/v2.0.1/available.abc.txt' },
  hskWriting: { '1': ['爱', '八'], '2': ['永'] },
  hskContext: { 爱: ['愛好|爱好[ai4 hao4]', 'sở thích'], 八: ['bad'] },
}

function routes(extra: Record<string, Answer | ((attempt: number) => Answer)> = {}) {
  return {
    [`${SITE}dict/v1/manifest.json`]: { status: 200, body: MANIFEST },
    [`${SITE}strokes/v2.0.1/available.abc.txt`]: { status: 200, body: '永你学', type: 'text/plain' },
    [`${SITE}strokes/v2.0.1/6c38.json`]: { status: 200, body: YONG },
    ...extra,
  }
}

function source(n: ReturnType<typeof net>, extra: Partial<StrokeSourceEnv> = {}) {
  const sleep = vi.fn(async () => {})
  const warn = vi.fn()
  const s = createStrokeSource({ siteUrl: () => SITE, fetch: n.fetch, sleep, warn, ...extra })
  return { s, sleep, warn }
}

describe('stroke fixtures', () => {
  it.each(TEST_CHARS.map((c) => [c.char, c.strokeCount] as const))(
    '%s has %i strokes, each with an outline and a median',
    (char, strokeCount) => {
      const data = fixtureStrokeData(char)
      expect(data).not.toBeNull()
      expect(data!.strokes).toHaveLength(strokeCount)
      expect(data!.medians).toHaveLength(strokeCount)
    },
  )
})

describe('createStrokeSource', () => {
  it('fetches the manifest, then the file beside the availability list, once each; then answers from memory', async () => {
    const n = net(routes())
    const { s } = source(n)
    const data = await s.load('永')
    expect(data?.strokes).toHaveLength(5)
    expect(await s.load('永')).toBe(data)
    expect(s.entry('永')).toEqual({ status: 'ready', data })
    expect(n.calls[0]).toBe(`${SITE}dict/v1/manifest.json`)
    expect([...n.calls].sort()).toEqual([`${SITE}dict/v1/manifest.json`, `${SITE}strokes/v2.0.1/6c38.json`, `${SITE}strokes/v2.0.1/available.abc.txt`].sort())
    // The manifest is asked of the server (one kept from before a deploy names a list the site no
    // longer has); the list and the files are named by version or hash.
    expect(n.inits[0]?.cache).toBe('no-cache')
    expect(n.inits.slice(1).map((i) => i?.cache)).toEqual(['force-cache', 'force-cache'])
  })

  it('answers "none" without a request for a character not in the list, once the list is in', async () => {
    const n = net(routes())
    const { s } = source(n)
    expect(await s.has('王')).toBe(false)
    expect(await s.has('你')).toBe(true)
    expect(await s.load('王')).toBeNull()
    expect(s.entry('王').status).toBe('none')
    expect(n.calls.some((u) => u.endsWith('738b.json'))).toBe(false)
  })

  it('before the list is in, a character whose file is not there (404) is "none"', async () => {
    const { s } = source(net(routes()))
    expect(await s.load('王')).toBeNull()
    expect(s.entry('王').status).toBe('none')
  })

  it('reads the site data: data version, stroke folder, the HSK writing lists and their context words', async () => {
    const { s } = source(net(routes()))
    const site = await s.siteData()
    expect(site).toMatchObject({
      dataVersion: 'test-1',
      strokesBase: `${SITE}strokes/v2.0.1/`,
      listUrl: `${SITE}strokes/v2.0.1/available.abc.txt`,
      hskWriting: MANIFEST.hskWriting,
    })
    expect(site?.hskContext).toEqual({ 爱: ['愛好|爱好[ai4 hao4]', 'sở thích'] })
  })

  it('a missing stroke list is an error, not "no stroke data" (a quick-add would skip every character)', async () => {
    const n = net(routes({ [`${SITE}strokes/v2.0.1/available.abc.txt`]: { status: 404 } }))
    const { s } = source(n)
    await expect(s.has('永')).rejects.toBeInstanceOf(DataUnavailableError)
    // The next ask tries again.
    await expect(s.has('永')).rejects.toBeInstanceOf(DataUnavailableError)
    expect(n.calls.filter((u) => u.endsWith('available.abc.txt'))).toHaveLength(2)
  })

  it('aborts an attempt that gets no answer in time, and retries it (PERF-1)', async () => {
    const n = net(routes())
    let first = true
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('6c38.json') && first) {
        first = false
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      return n.fetch(url, init)
    })
    const { s, sleep } = source({ ...n, fetch }, { timeoutMs: 20 })
    expect((await s.load('永'))?.strokes).toHaveLength(5)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.filter(([u]) => u.endsWith('6c38.json'))).toHaveLength(2)
  })

  it('treats a missing manifest (no data build) as "no data for any character"', async () => {
    const n = net({})
    const { s, warn } = source(n)
    expect(await s.siteData()).toBeNull()
    expect(await s.load('永')).toBeNull()
    expect(s.entry('永').status).toBe('none')
    expect(warn).toHaveBeenCalled()
  })

  it('treats a dev server’s HTML fallback as no data', async () => {
    const n = net({ [`${SITE}dict/v1/manifest.json`]: { status: 200, body: '<!doctype html>', type: 'text/html' } })
    const { s } = source(n)
    expect(await s.load('永')).toBeNull()
  })

  it('retries a network failure with increasing waits, then reports an error', async () => {
    const n = net(routes({ [`${SITE}strokes/v2.0.1/6c38.json`]: 'network-error' }))
    const { s, sleep } = source(n, { retryDelays: [10, 20, 40] })
    const seen: string[] = []
    s.subscribe(() => seen.push(s.entry('永').status))
    await expect(s.load('永')).rejects.toThrow('Failed to fetch')
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([10, 20, 40])
    expect(n.calls.filter((u) => u.endsWith('6c38.json'))).toHaveLength(4)
    expect(s.entry('永').status).toBe('error')
    expect(seen).toEqual(['loading', 'error'])
  })

  it('does not cache a failure: retry fetches again and can succeed', async () => {
    const n = net(routes({ [`${SITE}strokes/v2.0.1/6c38.json`]: (i) => (i < 2 ? 'network-error' : { status: 200, body: YONG }) }))
    const { s } = source(n, { retryDelays: [0] })
    await expect(s.load('永')).rejects.toThrow()
    s.retry('永')
    expect(s.entry('永').status).toBe('loading')
    await vi.waitFor(() => expect(s.entry('永').status).toBe('ready'))
  })

  it('does not retry a request the server refuses (4xx), and a failed manifest is asked for again', async () => {
    let refuse = true
    const n = net(routes({ [`${SITE}dict/v1/manifest.json`]: () => (refuse ? { status: 403 } : { status: 200, body: MANIFEST }) }))
    const { s, sleep } = source(n)
    const failure = await s.load('永').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(DataUnavailableError)
    expect(String((failure as Error).cause)).toContain('403')
    expect(sleep).not.toHaveBeenCalled()
    refuse = false
    expect((await s.load('永'))?.strokes).toHaveLength(5)
  })

  it('retries a server error (5xx)', async () => {
    const n = net(routes({ [`${SITE}dict/v1/manifest.json`]: (i) => (i === 0 ? { status: 503 } : { status: 200, body: MANIFEST }) }))
    const { s, sleep } = source(n)
    expect(await s.has('永')).toBe(true)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('loads a character once however many ask at the same time', async () => {
    const n = net(routes())
    const { s } = source(n)
    s.ensure('永')
    s.ensure('永')
    const [a, b] = await Promise.all([s.load('永'), s.load('永')])
    expect(a).toBe(b)
    expect(n.calls.filter((u) => u.endsWith('6c38.json'))).toHaveLength(1)
  })

  it('is "loading" before anything was asked, and "none" for what is not one character', () => {
    const { s } = source(net(routes()))
    expect(s.entry('永').status).toBe('loading')
    expect(s.entry('').status).toBe('none')
    expect(s.entry('学生').status).toBe('none')
  })

  it('reports a listed character whose file is invalid as "none"', async () => {
    const n = net(routes({ [`${SITE}strokes/v2.0.1/4f60.json`]: { status: 200, body: { strokes: [] } } }))
    const { s, warn } = source(n)
    expect(await s.load('你')).toBeNull()
    expect(s.entry('你').status).toBe('none')
    expect(warn).toHaveBeenCalled()
  })
})

describe('parseStrokeData', () => {
  const valid = { strokes: ['M 0 0 L 10 0 L 10 10 Z'], medians: [[[0, 0], [10, 10]]], radStrokes: [0] }
  const withMedian = (median: unknown) => ({ ...valid, medians: [median] })

  it('accepts well-formed data', () => {
    expect(parseStrokeData(valid)).toEqual(valid)
    expect(parseStrokeData({ strokes: valid.strokes, medians: valid.medians })).toEqual({
      strokes: valid.strokes,
      medians: valid.medians,
      radStrokes: undefined,
    })
  })

  it.each([
    ['null', null],
    ['a string', 'M 0 0 L 1 1 Z'],
    ['a number', 42],
    ['an array', []],
    ['missing medians', { strokes: valid.strokes }],
    ['no strokes', { strokes: [], medians: [] }],
    ['more outlines than medians', { strokes: [...valid.strokes, ...valid.strokes], medians: valid.medians }],
    ['an empty outline', { ...valid, strokes: [''] }],
    ['a non-string outline', { ...valid, strokes: [7] }],
    ['a median that is not an array', withMedian('0 0 10 10')],
    ['a single-point median', withMedian([[0, 0]])],
    ['a NaN coordinate', withMedian([[0, 0], [NaN, 1]])],
    ['an infinite coordinate', withMedian([[0, 0], [1, Infinity]])],
    ['a string coordinate', withMedian([[0, 0], ['1', 1]])],
    ['a point with one coordinate', withMedian([[0, 0], [1]])],
  ])('rejects %s', (_label, json) => {
    expect(parseStrokeData(json)).toBeNull()
  })

  it('drops malformed radStrokes but keeps the strokes', () => {
    const data = parseStrokeData({ ...valid, radStrokes: ['0'] })
    expect(data).not.toBeNull()
    expect(data!.radStrokes).toBeUndefined()
  })
})
