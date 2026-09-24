import { entryKey, parseKey } from './row'
import type { DictEntry } from './types'

/**
 * Which row of a character stands for it in a word, when one simplified form is several words: the
 * row whose traditional form is the word's (发 in 头发/頭髮 is 髮 "tóc", not 發 "gửi"), in the word's
 * reading (case too: 汉 in 汉语 Han4 is the Han people, not han4 "đàn ông"); and never a row that is
 * only a classical sense plus "variant of" another row of the same form (台 "(văn cổ) ông; biến thể
 * của 臺|台" → 臺|台 "đài; sân khấu"). Pure; shared by the entry page's character cards (engine.ts)
 * and the practice prompt (practiceItem.ts).
 */

const VARIANT_SENSE = /^(?:biến thể(?: cũ| cổ)? của|(?:\S+ )*variant of) ([^\s[\]]+\[[^\]]+\])/i
const MINOR_SENSE = /^[(（](?:văn cổ|cổ|cũ|văn ngôn|văn viết|classical|literary|archaic|old)[)）]/i
const CLASSIFIER_SENSE = /^\s*(?:lượng từ|cl)\s*:/i

/** The key of the row this one only stands in for (every other sense classical), or null. */
export function mainFormKey(e: Pick<DictEntry, 'simp' | 'vi' | 'en'>): string | null {
  let target: string | null = null
  for (const raw of e.vi.length ? e.vi : e.en) {
    const s = raw.trim()
    const m = VARIANT_SENSE.exec(s)
    if (m) {
      target ??= m[1]
      continue
    }
    if (MINOR_SENSE.test(s) || CLASSIFIER_SENSE.test(s)) continue
    return null
  }
  const p = target ? parseKey(target) : null
  return p && p.simp === e.simp ? entryKey(p.simp, p.trad, p.pinyin) : null
}

type Row = Pick<DictEntry, 'key' | 'simp' | 'trad' | 'pinyin' | 'vi' | 'en' | 'flags'>

const lettersOf = (p: string) => p.toLowerCase().replace(/u:|ü/g, 'v').replace(/[1-5]$/, '').trim()

/**
 * The best row of `char` among `rows` (its single-character rows, most common first) for use in a
 * word: `trad` is the word's traditional form of it (null: any), `syllable` its numbered reading
 * in the word (null: unknown), `exactCase` whether a capitalized syllable asks for the name row
 * (汉 in the common noun 汉语 Han4 is the Han people; 中 in the name 中国 Zhong1 is still "giữa").
 * Rows of `char` as a simplified form come first (all rows, for a traditional character). Falls
 * back step by step: same form and reading (then any case, then any tone) → same reading → same
 * form, not a name or variant → not a name or variant, with a meaning → the first row.
 */
export function pickCharRow<R extends Row>(
  rows: readonly R[],
  char: string,
  { trad = null, syllable = null, exactCase = false }: { trad?: string | null; syllable?: string | null; exactCase?: boolean } = {},
): R | null {
  const asSimp = rows.filter((r) => r.simp === char)
  const pool = asSimp.length ? asSimp : rows
  if (!pool.length) return null
  const sameForm = (r: R) => (trad === null ? true : r.trad === trad)
  const plain = (r: R) => !r.flags.includes('pn') && !r.flags.includes('var')
  const want = syllable?.trim() ?? ''
  const tests: ((r: R) => boolean)[] = []
  if (want) {
    const lower = want.toLowerCase().replace(/ü/g, 'u:')
    const letters = lettersOf(want)
    for (const form of [sameForm, () => true]) {
      if (exactCase) tests.push((r) => form(r) && r.pinyin === want)
      tests.push((r) => form(r) && r.pinyin.toLowerCase() === lower)
      tests.push((r) => form(r) && lettersOf(r.pinyin) === letters)
    }
  }
  tests.push((r) => sameForm(r) && plain(r))
  tests.push((r) => plain(r) && (r.vi.length > 0 || r.en.length > 0))
  let best: R = pool[0]
  for (const t of tests) {
    const found = pool.find(t)
    if (found) {
      best = found
      break
    }
  }
  const main = mainFormKey(best)
  return (main && pool.find((r) => r.key === main)) || best
}
