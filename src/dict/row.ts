import type { DictEntry } from './types'

/**
 * One data row (a line of a shard TSV) ↔ DictEntry, and the entry key.
 * Columns: simp · trad ('' = same) · pinyin · hv · hvAlt ('|') · vi ('/') · en ('/') · hsk · pop · flags (',').
 */

export const COL = { simp: 0, trad: 1, pinyin: 2, hv: 3, hvAlt: 4, vi: 5, en: 6, hsk: 7, pop: 8, flags: 9 } as const

/** Flags as bits, for ranking without parsing the row. */
export const FLAG_BITS: Record<string, number> = {
  pn: 1,
  var: 2,
  usedin: 4,
  mt: 8,
  'cur-ai': 16,
  cur: 32,
  en: 64,
  hvlow: 128,
  nostroke: 256,
  hvnom: 512,
  'hvcur-ai': 1024,
  hvcur: 2048,
  added: 4096,
}

export function flagBits(flags: string): number {
  if (!flags) return 0
  let bits = 0
  for (const f of flags.split(',')) bits |= FLAG_BITS[f] ?? 0
  return bits
}

/** The stable key of an entry: CC-CEDICT's "trad|simp[numbered pinyin]". */
export function entryKey(simp: string, trad: string, pinyin: string): string {
  return `${trad || simp}|${simp}[${pinyin}]`
}

/** "學生|学生[xue2 sheng5]" → parts; also accepts CC-CEDICT's cross-reference form without "|" ("的士[di1 shi4]"). */
export function parseKey(key: string): { trad: string; simp: string; pinyin: string } | null {
  const m = /^([^|[\]]+)(?:\|([^|[\]]+))?\[([^\]]*)\]$/.exec(key.trim())
  if (!m) return null
  const trad = m[1]
  const simp = m[2] ?? m[1]
  return { trad, simp, pinyin: m[3].trim() }
}

export function rowToEntry(f: readonly string[]): DictEntry {
  const simp = f[COL.simp]
  const trad = f[COL.trad] || simp
  const pinyin = f[COL.pinyin] ?? ''
  const hsk = Number(f[COL.hsk])
  return {
    key: entryKey(simp, trad, pinyin),
    simp,
    trad,
    pinyin,
    hv: f[COL.hv] ?? '',
    hvAlt: f[COL.hvAlt] ? f[COL.hvAlt].split('|') : [],
    vi: f[COL.vi] ? f[COL.vi].split('/') : [],
    en: f[COL.en] ? f[COL.en].split('/') : [],
    hsk: Number.isInteger(hsk) && hsk > 0 ? hsk : null,
    pop: Number(f[COL.pop]) || 0,
    flags: f[COL.flags] ? f[COL.flags].split(',') : [],
  }
}

const HAN = /\p{Script=Han}/u

export function isHan(ch: string): boolean {
  return HAN.test(ch)
}

/** The distinct Han characters of a word, in order (谢谢 → [谢]). */
export function hanChars(word: string): string[] {
  return [...new Set([...word].filter(isHan))]
}

/** Lowercase hex code point, the stroke file name and the practice route: 学 → '5b66'. */
export function charHex(ch: string): string {
  return (ch.codePointAt(0) ?? 0).toString(16)
}
