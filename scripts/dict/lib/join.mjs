// Joins CVDICT's Vietnamese senses onto CC-CEDICT entries. CVDICT was translated from an older
// CC-CEDICT, so keys drifted (re-capitalized proper nouns, corrected tones, re-chosen traditional
// forms). Four passes, strictest first (MEMO §1.1):
//   1. exact key
//   2. same trad + simp, pinyin equal ignoring case
//   3. same trad + simp, pinyin equal ignoring tones
//   4. same simp, pinyin equal ignoring tones (not for pure "variant of" entries)
// Passes 2–4 only use CVDICT entries whose own key is gone from CC-CEDICT, and only when exactly one
// such entry fits: a CVDICT entry that still has its exact match never lends its Vietnamese to a
// neighbour (the surname 和[He2] never gets the conjunction 和[he2]'s senses). They are also
// one-to-one: a leftover CVDICT entry that two CC-CEDICT entries would take (中土 Zhong1 tu3 and
// Zhong1 Tu3) goes to neither, and the curated deny list (data/overrides/join-deny.tsv) names the
// loose joins that are known to be another word's translation (累 lei2 → "họ Lei"). A row left
// without Vietnamese shows its English, labelled "chưa có bản dịch".
// A fifth pass covers main and variant forms that swapped places (see below). Pure; unit-tested.
import { dedupeEntries } from './cedict.mjs'
import { toneless } from './pinyin.mjs'

const VARIANT_ONLY = /^(?:\S+ )*variant of /i
/** CVDICT's own "variant of" wording: such a translation has nothing to lend (pass 5). */
const VI_VARIANT_NOTE = /biến thể|dạng khác của|cách viết khác/i
const VARIANT_REF = /variant of ([^\s|[\]]+)(?:\|([^\s|[\]]+))?\[([^\]]+)\]/gi

/** Whether every sense is a "variant of X" cross-reference. */
export const isVariantOnly = (defs) => defs.length > 0 && defs.every((d) => VARIANT_ONLY.test(d))

/** Keys the "variant of trad|simp[py]" references of an entry point at ("X[py]" = X|X[py]). */
export function variantTargets(defs) {
  const out = []
  for (const d of defs) for (const m of d.matchAll(VARIANT_REF)) out.push(`${m[1]}|${m[2] ?? m[1]}[${m[3]}]`)
  return out
}

/** Index of CVDICT entries by a derived key; a key two entries share maps to null (ambiguous). */
function uniqueIndex(entries, keyOf) {
  const idx = new Map()
  for (const e of entries) {
    const k = keyOf(e)
    idx.set(k, idx.has(k) ? null : e)
  }
  return idx
}

const isCapitalized = (py) => /(?:^|\s)[A-Z]/.test(py)

/**
 * @param ce CC-CEDICT entries ({ key, trad, simp, py, defs }), already deduplicated
 * @param cvRaw CVDICT entries as parsed (duplicate keys allowed: their senses are merged)
 * @param {{ deny?: Set<string> }} [opts] CC-CEDICT keys that take no loose (pass 2–4) join
 * @returns {{ vi: Map<string, { defs: string[], pass: 1|2|3|4, from: string }>, stats: object }}
 */
export function joinVietnamese(ce, cvRaw, { deny = new Set() } = {}) {
  const [cv, cvDuplicates] = dedupeEntries(cvRaw)
  const cvByKey = new Map(cv.map((e) => [e.key, e]))
  const ceKeys = new Set(ce.map((e) => e.key))
  const leftovers = cv.filter((e) => !ceKeys.has(e.key))

  const byCase = uniqueIndex(leftovers, (e) => `${e.trad}\t${e.simp}\t${e.py.toLowerCase()}`)
  const byToneless = uniqueIndex(leftovers, (e) => `${e.trad}\t${e.simp}\t${toneless(e.py)}`)
  const bySimp = uniqueIndex(leftovers, (e) => `${e.simp}\t${toneless(e.py)}`)

  // Who would take which leftover (passes 2–4), before anything is joined: one-to-one only.
  const loose = new Map()
  for (const e of ce) {
    if (cvByKey.has(e.key)) continue
    let hit = byCase.get(`${e.trad}\t${e.simp}\t${e.py.toLowerCase()}`)
    let pass = 2
    if (!hit) {
      pass = 3
      hit = byToneless.get(`${e.trad}\t${e.simp}\t${toneless(e.py)}`)
    }
    if (!hit && !isVariantOnly(e.defs)) {
      pass = 4
      hit = bySimp.get(`${e.simp}\t${toneless(e.py)}`)
    }
    if (hit) loose.set(e.key, { hit, pass })
  }
  const claims = new Map()
  for (const { hit } of loose.values()) claims.set(hit.key, (claims.get(hit.key) ?? 0) + 1)

  const vi = new Map()
  const used = new Set()
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 }
  const shared = []
  const denied = []
  const caseCrossings = []
  for (const e of ce) {
    const exact = cvByKey.get(e.key)
    if (exact) {
      vi.set(e.key, { defs: exact.defs, pass: 1, from: exact.key })
      used.add(exact.key)
      counts[1]++
      continue
    }
    const l = loose.get(e.key)
    if (!l) continue
    if (claims.get(l.hit.key) > 1) {
      shared.push(`${e.key} ← ${l.hit.key}`)
      continue
    }
    if (deny.has(e.key)) {
      denied.push(`${e.key} ← ${l.hit.key}`)
      continue
    }
    // A proper noun joined to a common word or back (教皇, 港元 are fine; 丽 li2 → "Hàn Quốc" was
    // not): listed for review, the bad ones go on the deny list.
    if (isCapitalized(e.py) !== isCapitalized(l.hit.py)) caseCrossings.push(`${e.key} ← ${l.hit.key}`)
    vi.set(e.key, { defs: l.hit.defs, pass: l.pass, from: l.hit.key })
    used.add(l.hit.key)
    counts[l.pass]++
  }

  // 5. The main and variant forms swapped since CVDICT's CC-CEDICT (電視臺 was the entry, 電視台
  //    now is): the variant entry, now only "variant of 電視台|电视台[…]", still carries CVDICT's full
  //    translation, and the main entry has none. Lend it, when exactly one variant does so.
  const lenders = new Map()
  for (const e of ce) {
    const got = vi.get(e.key)
    if (!got || !isVariantOnly(e.defs) || got.defs.some((d) => VI_VARIANT_NOTE.test(d))) continue
    for (const target of variantTargets(e.defs)) {
      if (!ceKeys.has(target) || vi.has(target)) continue
      const list = lenders.get(target) ?? []
      list.push(e.key)
      lenders.set(target, list)
    }
  }
  const byKey = new Map(ce.map((e) => [e.key, e]))
  counts[5] = 0
  for (const [target, list] of lenders) {
    if (list.length !== 1 || isVariantOnly(byKey.get(target).defs)) continue
    vi.set(target, { defs: vi.get(list[0]).defs, pass: 5, from: `${vi.get(list[0]).from} (via ${list[0]})` })
    counts[5]++
  }

  const stats = {
    cvdictEntries: cvRaw.length,
    cvdictDuplicateKeysMerged: cvDuplicates,
    joinedExact: counts[1],
    joinedCaseInsensitive: counts[2],
    joinedToneless: counts[3],
    joinedSimplifiedToneless: counts[4],
    borrowedFromVariant: counts[5],
    joinedTotal: counts[1] + counts[2] + counts[3] + counts[4] + counts[5],
    cedictRowsWithoutVietnamese: ce.length - vi.size,
    cvdictKeysNotInCedict: leftovers.length,
    cvdictEntriesUnused: cv.filter((e) => !used.has(e.key)).length,
    looseJoinsSkippedAsShared: shared,
    looseJoinsDenied: denied,
    looseJoinsAcrossProperNounCase: caseCrossings,
  }
  return { vi, stats }
}
