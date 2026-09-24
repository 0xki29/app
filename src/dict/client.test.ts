import { describe, expect, it } from 'vitest'
import { createDictionary, DictError, type Connect } from './client'
import { DictEngine } from './engine'
import type { FromWorker, ToWorker } from './protocol'
import { fakeNet, fixtureRoutes, MANIFEST_URL, memoryStore, SITE, testEnv, until } from './testHarness'

/** A dictionary whose "worker" is an in-process engine; messages cross on timers, like postMessage. */
function inProcess(routes = fixtureRoutes()) {
  const sent: ToWorker[] = []
  let fail: ((message: string) => void) | null = null
  let connections = 0
  const connect: Connect = (onMessage, onFailure) => {
    connections++
    fail = onFailure
    const engine = new DictEngine(testEnv(fakeNet(routes), memoryStore()), (msg: FromWorker) => {
      setTimeout(() => onMessage(structuredClone(msg)), 0)
    })
    return {
      post: (msg) => {
        sent.push(msg)
        setTimeout(() => engine.handle(structuredClone(msg)), 0)
      },
      close: () => {},
    }
  }
  const dict = createDictionary(connect, () => ({ manifestUrl: MANIFEST_URL, siteUrl: SITE }))
  return { dict, sent, crash: (m: string) => fail?.(m), connections: () => connections }
}

describe('dictionary client', () => {
  it('starts idle, with no worker until something is asked', () => {
    const t = inProcess()
    expect(t.dict.status()).toEqual({ state: 'idle', progress: 0 })
    expect(t.connections()).toBe(0)
  })

  it('reports status to subscribers and searches', async () => {
    const t = inProcess()
    const seen: string[] = []
    const off = t.dict.subscribe(() => seen.push(t.dict.status().state))
    t.dict.ensureLoaded()
    await until(() => t.dict.status().state === 'ready', 'ready')
    off()
    expect(seen).toContain('loading-core')
    expect(t.sent[0]).toEqual({ type: 'init', manifestUrl: MANIFEST_URL, siteUrl: SITE })
    const r = await t.dict.search('xuesheng')
    expect(r.hits[0].entry.key).toBe('學生|学生[xue2 sheng5]')
    expect(r.hits[0].entry.trad).toBe('學生')
  })

  it('marks a reply to a superseded search as stale', async () => {
    const t = inProcess()
    const first = t.dict.search('xue')
    const second = t.dict.search('xuesheng')
    expect((await first).stale).toBe(true)
    expect((await second).stale).toBe(false)
  })

  it('answers hasStrokes and hskWriting from the manifest alone', async () => {
    const t = inProcess()
    expect(await t.dict.hasStrokes('学')).toBe(true)
    expect(await t.dict.hasStrokes('呣')).toBe(false)
    expect((await t.dict.hskWriting(1)).length).toBeGreaterThan(0)
    expect(t.dict.status().state).toBe('idle')
    const meta = await t.dict.meta()
    expect(meta).not.toHaveProperty('available')
    expect(meta.dataVersion).toBe('fixture-1')
  })

  it('looks up entries, characters and words', async () => {
    const t = inProcess()
    expect((await t.dict.entry('謝謝|谢谢[xie4 xie5]'))?.vi[0]).toMatch(/cảm ơn/)
    expect((await t.dict.charInfo('學'))?.counterpart).toBe('学')
    expect((await t.dict.word('行|行[xing2]'))?.chars[0].char).toBe('行')
    expect(await t.dict.entry('nope')).toBeNull()
  })

  it('rejects with noData when the data was never built', async () => {
    const routes = fixtureRoutes()
    routes.delete(MANIFEST_URL)
    const t = inProcess(routes)
    await expect(t.dict.search('an')).rejects.toMatchObject({ noData: true })
    await expect(t.dict.hasStrokes('学')).rejects.toBeInstanceOf(DictError)
    await until(() => t.dict.status().state === 'no-data', 'no-data')
  })

  it('fails what is waiting when the worker dies, and starts a new one on the next call', async () => {
    const t = inProcess()
    const pending = t.dict.search('an')
    t.crash('boom')
    await expect(pending).rejects.toBeInstanceOf(DictError)
    expect(t.dict.status().state).toBe('error')
    expect((await t.dict.search('xuesheng')).hits[0].entry.simp).toBe('学生')
    expect(t.connections()).toBe(2)
  })
})
