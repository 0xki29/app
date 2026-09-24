import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { buildIndex, DictIndex } from './searchIndex'
import { idbSnapshotStore } from './snapshotStore'
import { FIXTURE_TEXTS } from './testHarness'

describe('idbSnapshotStore', () => {
  it('saves the index in pieces and reads it back whole', async () => {
    const store = idbSnapshotStore()!
    const index = buildIndex(FIXTURE_TEXTS)
    await store.saveIndex('v1#1', index.toParts())
    const back = await store.loadIndex('v1#1')
    expect(back).not.toBeNull()
    const copy = DictIndex.fromParts(back!)
    for (const q of ['an', '学生', 'hoc sinh', 'xuéshēng']) expect(copy.search(q)).toEqual(index.search(q))
    expect(await store.loadIndex('v2#1')).toBeNull()
  })

  it('keeps one snapshot: a new one replaces the old', async () => {
    const store = idbSnapshotStore()!
    const parts = buildIndex([FIXTURE_TEXTS[0]]).toParts()
    await store.saveIndex('a#1', parts)
    await store.saveIndex('b#1', parts)
    expect(await store.loadIndex('a#1')).toBeNull()
    expect(await store.loadIndex('b#1')).not.toBeNull()
  })

  it('never reads a snapshot whose writing was cut short', async () => {
    const store = idbSnapshotStore()!
    const parts = buildIndex([FIXTURE_TEXTS[0]]).toParts()
    // pieces written, "complete" missing: as if the tab closed while saving
    const req = indexedDB.open('cn-dict')
    await new Promise((r) => (req.onsuccess = r))
    await store.saveIndex('c#1', parts)
    const tx = req.result.transaction('index', 'readwrite')
    tx.objectStore('index').delete('c#1/complete')
    await new Promise((r) => (tx.oncomplete = r))
    req.result.close()
    expect(await store.loadIndex('c#1')).toBeNull()
  })

  it('keeps the manifest for an offline start', async () => {
    const store = idbSnapshotStore()!
    await store.saveMeta({ manifestUrl: 'u', manifest: { dataVersion: 'x' } as never, available: '学' })
    expect((await store.loadMeta())?.available).toBe('学')
  })
})
