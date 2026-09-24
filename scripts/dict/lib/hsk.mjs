// HSK 3.0 (2021) word and character lists from ivankra/hsk30 (MIT). The word list's CEDICT column
// names the CC-CEDICT key(s) of each word, taken from an older CC-CEDICT; `matchHskWord` resolves
// them against the current one.
import { looseMarked } from './pinyin.mjs'

/** RFC 4180-style CSV (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function records(text) {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** "1".."6" → 1..6, "7-9" → 7 (HSK 3.0 does not split the advanced band). */
export const levelNumber = (s) => (s === '7-9' ? 7 : Number(s))

const splitKeys = (s) =>
  (s || '')
    .split('/')
    .map((k) => k.trim())
    .filter(Boolean)

/**
 * The word list: one record per HSK word, with the CEDICT keys it names and its written forms
 * (a word such as 爸爸|爸 has two), each with its own pinyin and keys.
 */
export function readHskWords(csvText) {
  return records(csvText).map((r) => {
    const forms = []
    if (r.Variants) {
      for (const v of JSON.parse(r.Variants)) {
        if (v.Example) continue
        forms.push({ simp: v.Simplified, trad: v.Traditional || '', pinyin: v.Pinyin || '', keys: splitKeys(v.CEDICT) })
      }
    }
    if (!forms.length) forms.push({ simp: r.Simplified, trad: r.Traditional, pinyin: r.Pinyin, keys: splitKeys(r.CEDICT) })
    return { id: r.ID, simp: r.Simplified, level: levelNumber(r.Level), cedict: splitKeys(r.CEDICT), forms }
  })
}

/**
 * The character list: reading level, writing level (1–3 for the 1,200-character writing list), and
 * the list's "Freq" column — how many HSK words contain the character (不 207, 我 3), a word-family
 * count, not a text frequency.
 */
export function readHskChars(csvText) {
  return records(csvText).map((r) => ({
    char: r.Hanzi,
    level: levelNumber(r.Level),
    writingLevel: r.WritingLevel ? Number(r.WritingLevel) : null,
    words: Number(r.Freq) || 0,
  }))
}

/**
 * A writing list in the order a learner meets its characters: by text frequency (`freqOf`, higher
 * first), the list's own order (alphabetical by pinyin) breaking ties. Stable.
 */
export function byFrequency(chars, freqOf) {
  return chars
    .map((c, i) => ({ c, i, f: freqOf(c) }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .map((x) => x.c)
}

const lowerInitial = (pinyin) => /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(pinyin.normalize('NFC'))
/** A sense that is no reason to keep an entry's HSK tag: a cross-reference, a pronunciation note, a classical sense. */
const MINOR_SENSE = /^(?:(?:\S+ )*variant of |see(?: also)? |used in |also written |Taiwan pr\.|also pr\.|\((?:classical|literary|archaic|old|obsolete)\))/i

/**
 * Which of an HSK word's matched entries carry the tag, when the list's CEDICT column names more
 * than one entry for the same written form:
 * - an entry that is "variant of" another matched entry of the same simplified form, and has no
 *   other sense than cross-references and classical ones, gives way to it (台|台[tai2] "(classical)
 *   you; variant of 臺|台[tai2]" → only 臺|台[tai2] is HSK 3; 注|注[zhu4] "to pour into; …; variant
 *   of 註" keeps its tag);
 * - a proper-noun entry (capitalized pinyin) gives way to the common word with the same form and
 *   syllables when the list writes the word in lowercase (标致 biāozhì "pretty" is not 標致
 *   Biao1 zhi4 "Peugeot").
 * @param word a readHskWords record
 * @param {string[]} keys matchHskWord's result
 * @param {(key: string) => { key: string, simp: string, py: string, defs: string[] } | undefined} entryOf
 * @param {(simp: string) => { key: string, py: string }[]} bySimp
 * @param {(key: string) => string | null} resolveKey
 * @param {(defs: string[]) => string[]} variantTargetsOf "variant of" keys in an entry's senses
 * @returns {{ keys: string[], dropped: string[], swapped: string[] }}
 */
export function refineHskKeys(word, keys, { entryOf, bySimp, resolveKey, variantTargetsOf }) {
  const dropped = []
  const swapped = []
  const set = new Set(keys)
  for (const k of keys) {
    const e = entryOf(k)
    if (!e || !e.defs.every((d) => MINOR_SENSE.test(d))) continue
    const main = variantTargetsOf(e.defs)
      .map(resolveKey)
      .find((t) => t && t !== k && set.has(t) && entryOf(t)?.simp === e.simp)
    if (main) {
      set.delete(k)
      dropped.push(`${k} → ${main}`)
    }
  }
  for (const k of [...set]) {
    const e = entryOf(k)
    if (!e || !/(?:^|\s)[A-Z]/.test(e.py)) continue
    const form = word.forms.find((f) => f.simp === e.simp)
    if (!form || !lowerInitial(form.pinyin || word.forms[0]?.pinyin || '')) continue
    const common = bySimp(e.simp).find((o) => !/(?:^|\s)[A-Z]/.test(o.py) && o.py.toLowerCase().replace(/[1-5]/g, '') === e.py.toLowerCase().replace(/[1-5]/g, ''))
    if (!common) continue
    set.delete(k)
    set.add(common.key)
    swapped.push(`${k} → ${common.key}`)
  }
  return { keys: [...set], dropped, swapped }
}

const stripMarks = (s) => s.normalize('NFD').replace(/[\u0300\u0301\u0304\u030C]/g, '').normalize('NFC')

/**
 * The current CC-CEDICT keys of an HSK word: each named key if it still exists (else the key it now
 * resolves to, see `resolveKey`), else — for a form that names none — the entries with the same
 * simplified form whose tone-marked reading equals the list's, else the one entry whose reading
 * does ignoring tones (the list prints citation tones: 说起来 shuō qǐlái, CC-CEDICT qi3 lai5).
 * @param word a readHskWords record
 * @param resolveKey (key) => current key or null
 * @param bySimp (simp) => entries ({ key, py, markedKey })
 */
export function matchHskWord(word, resolveKey, bySimp) {
  const keys = new Set()
  for (const k of word.cedict) {
    const r = resolveKey(k)
    if (r) keys.add(r)
  }
  for (const f of word.forms) {
    let found = false
    for (const k of f.keys) {
      const r = resolveKey(k)
      if (r) {
        keys.add(r)
        found = true
      }
    }
    if (found) continue
    const want = looseMarked(f.pinyin)
    const same = bySimp(f.simp)
    const exact = same.filter((e) => e.markedKey === want)
    const loose = same.filter((e) => stripMarks(e.markedKey) === stripMarks(want))
    for (const e of exact.length ? exact : loose.length === 1 ? loose : []) keys.add(e.key)
  }
  return [...keys]
}
