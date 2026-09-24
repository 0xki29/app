// Sense-level cleanup shared by the Vietnamese (CVDICT) and English (CC-CEDICT) columns:
// classifier notes in one form, "Lượng từ: 个 (gè), 位 (wèi)", always the last sense; cross-references
// in CC-CEDICT notation resolved to current keys; English-only cross-reference entries translated
// by template. Pure; unit-tested.
import { entryKey } from './cedict.mjs'
import { pinyinMarks, toneless } from './pinyin.mjs'
import { normalizeViText } from './vietnamese.mjs'

const CL_LABEL = '(?:CL|LT|[Ll]ượng từ)\\s*[:：]\\s*'
const CL_WHOLE = new RegExp(`^${CL_LABEL}(.+)$`, 'u')
const CL_WHOLE_PARENS = new RegExp(`^[(（]\\s*${CL_LABEL}([^()（）]+?)\\s*[)）]$`, 'u')
const CL_INLINE = new RegExp(`\\s*[(（]\\s*${CL_LABEL}([^()（）]+?)\\s*[)）]`, 'gu')
const CL_TRAILING = new RegExp(`\\s*[;；]\\s*${CL_LABEL}(.+)$`, 'u')
const CL_ITEM = /^([^|[\]\s]+)(?:\|([^|[\]\s]+))?\[([^\]]+)\]$/

/** "個|个[ge4]" → "个 (gè)"; an item that is not a reference is kept as written. */
export function formatClassifier(item) {
  const m = CL_ITEM.exec(item.trim())
  return m ? `${m[2] ?? m[1]} (${pinyinMarks(m[3])})` : item.trim()
}

/** Splits classifier notes out of a sense: { rest: the sense without them ('' if nothing else), items }. */
export function extractClassifiers(sense) {
  const items = []
  const take = (list) => items.push(...list.split(/\s*[,，、]\s*/).filter(Boolean))
  const whole = CL_WHOLE_PARENS.exec(sense) ?? CL_WHOLE.exec(sense)
  if (whole) {
    take(whole[1])
    return { rest: '', items }
  }
  let rest = sense.replace(CL_INLINE, (_, list) => {
    take(list)
    return ''
  })
  rest = rest.replace(CL_TRAILING, (_, list) => {
    take(list)
    return ''
  })
  return { rest: rest.trim(), items }
}

const REF = /([^\s|[\](),;:/"'“”‘’，。、（）：；]+)(?:\|([^\s|[\](),;:/"'“”‘’，。、（）：；]+))?\[([A-Za-z0-9:üÜ·,' ]+)\]/gu
const HAN = /\p{Script=Han}/u
const HAN_G = /\p{Script=Han}/gu

/**
 * Rewrites CC-CEDICT cross-references ("see 什麼|什么[shen2 me5]", "variant of 了[liao3]") to the
 * current key of the entry they point at, in CC-CEDICT notation: "trad|simp[py]", or "simp[py]"
 * when both forms are the same — so the client can link them. Pinyin written without spaces
 * ("仿效[fang3xiao4]") and the two forms written the wrong way round ("辽宁|遼寧") are read too.
 * A reference that does not resolve to exactly one entry is no link: it becomes plain text, the
 * simplified form with its pinyin in tone marks when there is one syllable per character
 * ("安全检查 (ān quán jiǎn chá)"), else the hanzi alone ("以…的身份[yi3 xx5 …]" → "以…的身份").
 * Counted in `counts`; `unresolvedSeen` collects the first few for the build report.
 * @param index from createKeyIndex
 */
export function canonicalRefs(text, index, counts = { resolved: 0, unresolved: 0 }, unresolvedSeen = null) {
  return text.replace(REF, (whole, a, b, rawPy) => {
    if (!HAN.test(a) && !(b && HAN.test(b))) return whole
    const py = rawPy.trim().replace(/([1-5])(?=[A-Za-z])/g, '$1 ').replace(/\s+/g, ' ')
    const bySingleForm = (form) => {
      const direct = index.resolve(entryKey(form, form, py))
      if (direct) return direct
      const cands = [...index.bySimp(form), ...index.byTrad(form)]
      const pick = (f) => {
        const keys = [...new Set(cands.filter(f).map((e) => e.key))]
        return keys.length === 1 ? keys[0] : null
      }
      return pick((e) => e.py.toLowerCase() === py.toLowerCase()) ?? pick((e) => toneless(e.py) === toneless(py))
    }
    const key = b ? (index.resolve(entryKey(a, b, py)) ?? index.resolve(entryKey(b, a, py))) : bySingleForm(a)
    if (!key) {
      counts.unresolved++
      if (unresolvedSeen && unresolvedSeen.length < 100) unresolvedSeen.push(whole)
      const hanzi = b ?? a
      const syllables = py.split(' ').filter(Boolean)
      const oneEach = syllables.length === (hanzi.match(HAN_G) ?? []).length && syllables.every((s) => /^[A-Za-z:]+[1-5]$/.test(s))
      return oneEach ? `${hanzi} (${pinyinMarks(py)})` : hanzi
    }
    counts.resolved++
    const e = index.get(key)
    return e.trad === e.simp ? `${e.simp}[${e.py}]` : `${e.trad}|${e.simp}[${e.py}]`
  })
}

/**
 * Cleans a list of senses: NFC and spacing (plus hoà-style tone marks for Vietnamese), classifier
 * notes gathered into one last sense, cross-references resolved, empty and repeated senses dropped.
 * @param {{ vietnamese?: boolean, index?: object, refCounts?: object, unresolvedSeen?: string[] }} opts
 */
export function normalizeSenses(senses, { vietnamese = false, index = null, refCounts, unresolvedSeen = null } = {}) {
  const out = []
  const classifiers = []
  for (const raw of senses) {
    let s = vietnamese ? viPronunciationNote(normalizeViText(raw)) : raw.normalize('NFC').replace(/\s+/g, ' ').trim()
    const { rest, items } = extractClassifiers(s)
    for (const it of items) {
      const c = formatClassifier(it)
      if (!classifiers.includes(c)) classifiers.push(c)
    }
    s = rest
    if (index) s = canonicalRefs(s, index, refCounts, unresolvedSeen)
    if (s && !out.includes(s)) out.push(s)
  }
  if (classifiers.length) out.push(`Lượng từ: ${classifiers.join(', ')}`)
  return out
}

/**
 * CVDICT renders CC-CEDICT's "Taiwan pr. [fa3]" as "phiên âm Đài Loan [fa3]", which reads as a
 * romanization; it is how the word is pronounced in Taiwan. A place name's "(phiên âm Đài Loan)",
 * a Taiwanese transliteration, is left alone (no pinyin in brackets follows it).
 */
export function viPronunciationNote(sense) {
  return sense.replace(/phiên âm Đài Loan:?\s*(\[[^\]]+\])/g, 'cách đọc ở Đài Loan $1')
}

const TEMPLATES = [
  [/^see also (.+)$/, 'xem thêm $1'],
  [/^see (.+)$/, 'xem $1'],
  [/^used in (.+)$/, 'dùng trong $1'],
  [/^(?:also written|also written as) (.+)$/, 'cũng viết là $1'],
  [/^variant of (.+)$/, 'biến thể của $1'],
  [/^old variant of (.+)$/, 'biến thể cũ của $1'],
  [/^(?:archaic|ancient) variant of (.+)$/, 'biến thể cổ của $1'],
  [/^erhua variant of (.+)$/, 'biến thể nhi hoá của $1'],
  [/^Japanese variant of (.+)$/, 'biến thể tiếng Nhật của $1'],
  [/^Taiwan variant of (.+)$/, 'biến thể Đài Loan của $1'],
  [/^Taiwan pr\. (\[[^\]]+\])$/, 'cách đọc ở Đài Loan $1'],
  [/^also pr\. (\[[^\]]+\])$/, 'cũng đọc $1'],
]

/**
 * Vietnamese for an entry whose senses are all cross-references ("used in X" → "dùng trong X",
 * "variant of X" → "biến thể của X", …), or null if any sense is something else.
 */
export function templateXrefs(defs) {
  const out = []
  for (const d of defs) {
    const t = TEMPLATES.find(([re]) => re.test(d))
    if (!t) return null
    out.push(d.replace(t[0], t[1]))
  }
  return out.length ? out : null
}
