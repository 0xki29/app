import { openDB, type DBSchema } from 'idb'
import type { SavedMeta, SnapshotStore } from './engine'
import type { IndexParts } from './searchIndex'

/**
 * IndexedDB storage for the dictionary (database "cn-dict"): the last manifest with the stroke
 * availability list (to start offline), and one snapshot of the built index, keyed by data version
 * and index format. Private browsing or a full disk only costs the fast start: every failure is
 * caught by the engine.
 *
 * The snapshot (~40 MB) is written piece by piece, one transaction each: copying it for IndexedDB
 * happens on the worker's thread, and in pieces searches get answered in between. A "complete"
 * record is written last, so a snapshot cut short (tab closed) is never read.
 */

interface DictDB extends DBSchema {
  meta: { key: string; value: SavedMeta }
  index: { key: string; value: unknown }
}

interface Complete {
  pieces: string[]
}

interface Rows {
  format: number
  pop: Uint8Array
  flags: Uint16Array
  hsk: Uint8Array
  py: string
  shards: number
}

export function idbSnapshotStore(): SnapshotStore | null {
  if (typeof indexedDB === 'undefined') return null
  let db: ReturnType<typeof openDB<DictDB>> | null = null
  const open = () =>
    (db ??= openDB<DictDB>('cn-dict', 1, {
      upgrade(d) {
        d.createObjectStore('meta')
        d.createObjectStore('index')
      },
    }))
  return {
    async loadMeta() {
      return (await (await open()).get('meta', 'current')) ?? null
    },
    async saveMeta(meta) {
      await (await open()).put('meta', meta, 'current')
    },
    async loadIndex(key) {
      const d = await open()
      const done = (await d.get('index', `${key}/complete`)) as Complete | undefined
      if (!done) return null
      const tx = d.transaction('index')
      const values = await Promise.all(done.pieces.map((p) => tx.store.get(`${key}/${p}`)))
      const piece = new Map(done.pieces.map((p, i) => [p, values[i]]))
      const rows = piece.get('rows') as Rows | undefined
      if (!rows || values.some((v) => v === undefined)) return null
      const parts: IndexParts = {
        format: rows.format,
        shards: [],
        pop: rows.pop,
        flags: rows.flags,
        hsk: rows.hsk,
        py: rows.py,
        keys: {} as IndexParts['keys'],
        postings: {} as IndexParts['postings'],
      }
      for (let i = 0; i < rows.shards; i++) parts.shards.push(piece.get(`shard${i}`) as IndexParts['shards'][number])
      for (const [name, value] of piece) {
        if (name.startsWith('keys.')) (parts.keys as Record<string, unknown>)[name.slice(5)] = value
        else if (name.startsWith('postings.')) (parts.postings as Record<string, unknown>)[name.slice(9)] = value
      }
      return parts
    },
    async saveIndex(key, parts) {
      const d = await open()
      await d.clear('index')
      const pieces: [string, unknown][] = [
        ...parts.shards.map((s, i): [string, unknown] => [`shard${i}`, s]),
        [
          'rows',
          { format: parts.format, pop: parts.pop, flags: parts.flags, hsk: parts.hsk, py: parts.py, shards: parts.shards.length } satisfies Rows,
        ],
        ...Object.entries(parts.keys).map(([k, v]): [string, unknown] => [`keys.${k}`, v]),
        ...Object.entries(parts.postings).map(([k, v]): [string, unknown] => [`postings.${k}`, v]),
      ]
      for (const [name, value] of pieces) await d.put('index', value, `${key}/${name}`)
      await d.put('index', { pieces: pieces.map((p) => p[0]) } satisfies Complete, `${key}/complete`)
    },
  }
}
