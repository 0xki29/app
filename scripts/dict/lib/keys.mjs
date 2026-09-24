// Lookup of entries by key and by headword, and resolution of keys written against an older
// CC-CEDICT (HSK lists, curated overrides, cross-references) to the current ones. Pure; unit-tested.
import { parseKey } from './cedict.mjs'
import { markedKey, toneless } from './pinyin.mjs'

function push(map, k, v) {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

/** @param entries [{ key, trad, simp, py }] */
export function createKeyIndex(entries) {
  const byKey = new Map()
  const bySimp = new Map()
  const byTrad = new Map()
  for (const e of entries) {
    const item = { key: e.key, trad: e.trad, simp: e.simp, py: e.py, markedKey: markedKey(e.py) }
    byKey.set(e.key, item)
    push(bySimp, e.simp, item)
    push(byTrad, e.trad, item)
  }

  /** The one candidate that fits, or null when none or several do. */
  const only = (list) => (list.length === 1 ? list[0].key : null)

  /**
   * A key's current form: itself if it exists; else the single entry with the same headword whose
   * pinyin is equal ignoring case, else equal ignoring tones (是不是 shi4 bu4 shi4 → bu5).
   * Null when nothing or more than one entry fits.
   */
  function resolve(key) {
    if (byKey.has(key)) return key
    const k = parseKey(key)
    if (!k) return null
    const same = (byTrad.get(k.trad) || []).filter((e) => e.simp === k.simp)
    return (
      only(same.filter((e) => e.py.toLowerCase() === k.py.toLowerCase())) ??
      only(same.filter((e) => toneless(e.py) === toneless(k.py)))
    )
  }

  return {
    has: (key) => byKey.has(key),
    get: (key) => byKey.get(key) ?? null,
    resolve,
    bySimp: (s) => bySimp.get(s) || [],
    byTrad: (t) => byTrad.get(t) || [],
  }
}
