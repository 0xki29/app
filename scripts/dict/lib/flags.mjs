// Row flags (the shard's last column) and the popularity score behind the row order. Pure;
// unit-tested.
import { isCapitalized, syllables } from './pinyin.mjs'
import { isVariantOnly } from './join.mjs'

/** Every flag, in the order a row lists them. */
export const FLAGS = [
  'pn', // proper noun (CC-CEDICT capitalizes its pinyin)
  'var', // only "variant of X" (and other cross-references)
  'usedin', // only "used in X" / "see (also) X" (and other cross-references)
  'mt', // vi is CVDICT's machine translation
  'cur-ai', // vi curated by AI, awaiting review
  'cur', // vi reviewed by a human
  'en', // no Vietnamese: English senses shown instead
  'hvlow', // Hán Việt has a low-confidence syllable (Unihan kVietnamese, or another pinyin's reading)
  'hvnom', // …and one of them is Unihan kVietnamese, which mixes in Nôm readings
  'hvcur-ai', // Hán Việt set or corrected by curation (hanviet-word.tsv, hanviet-char.tsv), AI draft awaiting review
  'hvcur', // …reviewed by a human
  'nostroke', // a character of the headword (simplified or traditional) has no stroke data
  'added', // an entry CC-CEDICT lacks, written by curation (data/overrides/extra-entries.tsv)
]

const XREF = /^(?:see(?: also)? |used in |also written |(?:\S+ )*variant of )/i
const SEE_OR_USED = /^(?:see(?: also)? |used in )/i
const PRONUNCIATION_NOTE = /^(?:Taiwan pr\.|also pr\.) \[/

/** Whether every sense is a cross-reference to another entry (pronunciation notes aside). */
export function isXrefOnly(defs) {
  const meaning = defs.filter((d) => !PRONUNCIATION_NOTE.test(d))
  return meaning.length > 0 && meaning.every((d) => XREF.test(d))
}

export const isProperNoun = (py) => syllables(py).some(isCapitalized)

/**
 * @param {object} e
 * @param {string} e.py numbered pinyin
 * @param {string[]} e.defs CC-CEDICT English senses
 * @param {'cvdict'|'curated-ai'|'curated'|'template'|null} e.viSource where the vi column came from
 * @param {boolean} e.enShown the en column is filled (no Vietnamese)
 * @param {boolean} e.hvLow
 * @param {boolean} [e.hvNom] the low-confidence syllable is Unihan kVietnamese (may be Nôm)
 * @param {'ai-draft'|'reviewed'|null} [e.hvCurated] the reading comes from a curated file, with that status
 * @param {boolean} e.noStroke
 * @param {boolean} [e.notProperNoun] a common noun CC-CEDICT capitalizes (汉语, 星期天): no pn flag
 * @param {boolean} [e.added] the entry comes from extra-entries.tsv, not from CC-CEDICT
 */
export function entryFlags({ py, defs, viSource, enShown, hvLow, hvNom = false, hvCurated = null, noStroke, notProperNoun = false, added = false }) {
  const on = new Set()
  if (isProperNoun(py) && !notProperNoun) on.add('pn')
  if (isXrefOnly(defs)) {
    if (isVariantOnly(defs) || defs.some((d) => /variant of /i.test(d))) on.add('var')
    if (defs.some((d) => SEE_OR_USED.test(d))) on.add('usedin')
  }
  if (viSource === 'cvdict') on.add('mt')
  if (viSource === 'curated-ai') on.add('cur-ai')
  if (viSource === 'curated') on.add('cur')
  if (enShown) on.add('en')
  if (hvLow) on.add('hvlow')
  if (hvLow && hvNom) on.add('hvnom')
  if (hvCurated === 'ai-draft') on.add('hvcur-ai')
  if (hvCurated === 'reviewed') on.add('hvcur')
  if (noStroke) on.add('nostroke')
  if (added) on.add('added')
  return FLAGS.filter((f) => on.has(f))
}

/** Popularity bonus by HSK 3.0 level (7 = 7–9) on the 0–100 pop scale. */
export const HSK_POP = { 1: 20, 2: 17, 3: 14, 4: 11, 5: 8, 6: 5, 7: 2 }

/** Penalty for a reading or form wordfreq cannot tell apart from the common one (Zipf units). */
export const SECONDARY_PENALTY = 1.5
/** The largest share penalty a rare kHanyuPinlu reading gets. */
const MAX_SHARE_PENALTY = 4

/**
 * Rank score: wordfreq Zipf (0 when absent) minus penalties. wordfreq counts a written form, not
 * a reading or a sense, so every row of 的 or 和 gets the same Zipf; the penalties share it out:
 * - variant-only entries sink (−3), other cross-reference-only entries fall just below the full
 *   entry (−0.5), and a proper noun loses ties with the common word (−0.05);
 * - a single character's readings by Unihan kHanyuPinlu: the most frequent keeps the full Zipf, the
 *   others get log10 of their share (的 dì: 52 of 75,805 → −3.2, at most −4), and a reading
 *   kHanyuPinlu does not list −1.5 (约 yāo, 离 chī);
 * - `secondary` (−1.5): a single-character proper noun (和 Hé the surname) next to the common word,
 *   or a row that is a variant of another row with the same simplified form (妳 for 你).
 * @param {Map<string, number>} [pinlu] reading (numbered, lowercase) → count, for single characters
 */
export function rankScore({ zipf = 0, defs, py, single = false, pinlu = null, secondary = false, properNoun = isProperNoun(py) }) {
  let s = zipf
  if (isVariantOnly(defs)) s -= 3
  else if (isXrefOnly(defs)) s -= 0.5
  if (properNoun) s -= 0.05
  if (single && pinlu && pinlu.size > 0) {
    const syl = py.toLowerCase()
    const max = Math.max(...pinlu.values())
    const total = [...pinlu.values()].reduce((a, b) => a + b, 0)
    if (!pinlu.has(syl)) s -= SECONDARY_PENALTY
    else if (pinlu.get(syl) < max) s -= Math.min(MAX_SHARE_PENALTY, -Math.log10(pinlu.get(syl) / total))
  }
  if (secondary) s -= SECONDARY_PENALTY
  return s
}

/** The pop column: 10 × score plus the HSK bonus, clamped to 0–100. */
export const popularity = (score, hsk) =>
  Math.max(0, Math.min(100, Math.round(10 * score + (hsk ? HSK_POP[hsk] : 0))))

/**
 * Row order: HSK words first (level 1 … 7–9), then everything else; within each group by score,
 * then shorter headwords, then code-unit order of simplified, pinyin, traditional (deterministic).
 */
export function compareRows(a, b) {
  const ga = a.hsk ?? 8
  const gb = b.hsk ?? 8
  if (ga !== gb) return ga - gb
  if (a.score !== b.score) return b.score - a.score
  const la = [...a.simp].length
  const lb = [...b.simp].length
  if (la !== lb) return la - lb
  for (const f of ['simp', 'py', 'trad']) if (a[f] !== b[f]) return a[f] < b[f] ? -1 : 1
  return 0
}
