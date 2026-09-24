// Âm Hán Việt of a word, character by character, from the traditional form of that entry (MEMO §2,
// the han-viet workstream's `m_improved`, without its QuickTranslator data). Pure given its inputs;
// unit-tested on the 40-word polyphone set.
//
// For each Han character c at position i (non-Han characters pass through):
//   0. the curated character table (data/overrides/hanviet-char.tsv) for c read as pinyin_i, or for
//      c under any reading: it replaces the word list's candidates where the list puts a
//      vernacular (Việt-hoá) form first or has no Sino-Vietnamese reading at all (冷 lạnh → lãnh,
//      讀 đọc → độc, 受 thọ → thụ);
//   1. wordlist[c]['*'] — one reading list for every pinyin;
//   2. wordlist[c][pinyin_i] — the exact numbered reading;
//   3. otherwise (neutral tone, or a reading the list lacks) the first of these that the list has
//      and that is the same syllable: the gloss's "Taiwan pr." syllable, the syllable other CC-CEDICT
//      readings of the same headword have at i, Unihan kMandarin; then the union of the list's
//      readings of that toneless syllable;
//   4. steps 1–3 on c's Unihan variants (traditional, semantic, z-variants);
//   5. Unihan kVietnamese, flagged low-confidence (it mixes in Nôm readings);
//   6. the list's readings of c under any other pinyin, flagged low-confidence too (124 rows; the
//      98.5% coverage the memo measured includes them);
//   7. otherwise nothing.
import { isHan, marksToNumbered } from './pinyin.mjs'
import { variantsOf } from './unihan.mjs'
import { capitalize, normalizeHvSyllable } from './vietnamese.mjs'

const stripTone = (p) => p.replace(/[1-5]$/, '')
const unique = (xs) => [...new Set(xs)]

const WORDLIST_PREFIX = 'export const hanvietData = '

/**
 * hanviet-pinyin-words' src/hanvietData.js is one object literal behind an export: read it as JSON,
 * never execute it. Shape: { char: { numbered pinyin | '*': readings[] } }.
 */
export function parseWordlist(jsText) {
  if (!jsText.startsWith(WORDLIST_PREFIX)) throw new Error('hanvietData.js: unexpected format')
  return JSON.parse(jsText.slice(WORDLIST_PREFIX.length).replace(/;?\s*$/, ''))
}

/** "Taiwan pr. [bu4 fen4]" in an entry's senses, as syllables (a hint for neutral tones). */
export function taiwanReading(defs) {
  for (const d of defs) {
    const m = /Taiwan pr\. \[([^\]]+)\]/.exec(d)
    if (m) return m[1].replace(/([1-5])(?=[a-zA-Z])/g, '$1 ').split(/\s+/)
  }
  return undefined
}

/**
 * The character table (data/overrides/hanviet-char.tsv rows, from readCuratedTsv): traditional
 * character + numbered pinyin (or '*' for every reading) → the readings to use, first one shipped,
 * and the vernacular forms that must never ship for it (the `hv-vernacular` gate).
 * @returns {Map<string, { readings: string[], vernacular: string[], status: string }>} keyed "char\tpinyin"
 */
export function readCharTable(rows, file = 'hanviet-char.tsv') {
  const out = new Map()
  for (const r of rows) {
    if ([...r.char].length !== 1 || !isHan(r.char)) throw new Error(`${file}: "${r.char}" is not one Han character`)
    if (r.pinyin !== '*' && !/^[a-z:]+[1-5]$/.test(r.pinyin)) throw new Error(`${file}: ${r.char}: pinyin "${r.pinyin}" is not numbered lowercase pinyin or *`)
    const k = `${r.char}\t${r.pinyin}`
    if (out.has(k)) throw new Error(`${file}: two rows for ${r.char} ${r.pinyin}`)
    const list = (s) => (s === '-' ? [] : unique(s.split('|').map(normalizeHvSyllable).filter(Boolean)))
    const readings = list(r.hanviet)
    if (!readings.length) throw new Error(`${file}: ${r.char} ${r.pinyin}: no reading`)
    const vernacular = list(r.vernacular)
    const clash = vernacular.find((v) => readings.includes(v))
    if (clash) throw new Error(`${file}: ${r.char} ${r.pinyin}: "${clash}" is both a reading and a vernacular form`)
    out.set(k, { readings, vernacular, status: r.status })
  }
  return out
}

/** The table's row for a character read as `p` (numbered, lowercase), or for every reading of it. */
export const charTableRow = (table, ch, p) => table?.get(`${ch}\t${p}`) ?? table?.get(`${ch}\t*`) ?? null

/**
 * @param {object} deps
 * @param {Record<string, Record<string, string[]>>} deps.wordlist hanviet-pinyin-words data
 * @param {Map<string, Record<string, string>>} deps.unihan fields from readUnihanZip
 * @param {(trad: string) => string[][]} deps.readingsOf numbered syllables of every CC-CEDICT
 *   reading of a headword (traditional form)
 * @param {Map<string, { readings: string[] }>} [deps.charTable] readCharTable of hanviet-char.tsv
 */
export function createHanViet({ wordlist, unihan, readingsOf, charTable = null }) {
  function lookup(ch, p, alts) {
    const e = wordlist[ch]
    if (!e) return null
    if (e['*']?.length) return { cands: e['*'], how: 'any' }
    if (e[p]?.length) return { cands: e[p], how: 'exact' }
    const base = stripTone(p)
    for (const a of alts) if (stripTone(a) === base && e[a]?.length) return { cands: e[a], how: 'alt' }
    const same = Object.keys(e).filter((k) => stripTone(k) === base && e[k].length)
    if (same.length) return { cands: unique(same.flatMap((k) => e[k])), how: 'toneless' }
    return null
  }

  function kMandarin(ch) {
    const km = unihan.get(ch)?.kMandarin
    return km ? marksToNumbered(km.split(/\s+/)[0]).toLowerCase() : null
  }

  /**
   * Resolves each character of `trad` read as `pys` (numbered syllables, same length).
   * @param {{ taiwan?: string[] }} [opts] the gloss's "Taiwan pr." syllables, if any
   * @returns {{ ch: string, han: boolean, cands: string[], how: string }[] | null}
   *   null when the headword and its pinyin do not align one to one
   */
  function resolveChars(trad, pys, { taiwan } = {}) {
    const chars = [...trad]
    if (chars.length !== pys.length) return null
    const others = readingsOf(trad).filter((r) => r.length === chars.length)
    return chars.map((c, i) => {
      if (!isHan(c)) return { ch: c, han: false, cands: [c], how: 'pass' }
      const p = pys[i].toLowerCase()
      const curated = charTableRow(charTable, c, p)
      if (curated) return { ch: c, han: true, cands: curated.readings, how: 'char-table', status: curated.status }
      const altsFor = (ch) => {
        const alts = []
        if (taiwan && taiwan.length === chars.length) alts.push(taiwan[i].toLowerCase())
        for (const r of others) alts.push(r[i].toLowerCase())
        const km = kMandarin(ch)
        if (km) alts.push(km)
        return alts
      }
      let r = lookup(c, p, altsFor(c))
      if (!r) {
        for (const v of variantsOf(unihan, c)) {
          r = lookup(v, p, altsFor(v))
          if (r) {
            r = { cands: r.cands, how: `variant-${r.how}` }
            break
          }
        }
      }
      if (!r) {
        let k = unihan.get(c)?.kVietnamese
        if (!k) for (const v of variantsOf(unihan, c)) if ((k = unihan.get(v)?.kVietnamese)) break
        if (k) r = { cands: k.split(/\s+/), how: 'unihan' }
      }
      if (!r && wordlist[c]) {
        // The list knows the character only under another pinyin (咖 ga1 → ca, listed for ka1).
        const all = unique(Object.values(wordlist[c]).flat())
        if (all.length) r = { cands: all, how: 'other-reading' }
      }
      if (!r) return { ch: c, han: true, cands: [], how: 'none' }
      const cands = unique(r.cands.map(normalizeHvSyllable).filter(Boolean))
      return { ch: c, han: true, cands, how: cands.length ? r.how : 'none' }
    })
  }

  return { resolveChars }
}

/**
 * The word reading from resolved characters: the first candidate of each character, runs of
 * non-Han characters kept as one token ("X quang", "khải lạp OK"), punctuation dropped. Alternates
 * change one character at a time (at most `maxAlts`), so "thuy giac" also finds 睡覺.
 * `low`: a syllable is low-confidence — `nom` when it comes from Unihan kVietnamese (which mixes in
 * Nôm readings), otherwise it is the list's reading of the character under another pinyin.
 * `curated`: the status of the character-table rows used ('ai-draft' if any is), or null.
 * @returns {{ hv: string, alts: string[], low: boolean, nom: boolean, curated: string | null } | null} null if a Han character has no reading
 */
export function wordReading(resolved, { properNoun = false, maxAlts = 5 } = {}) {
  if (!resolved || !resolved.some((r) => r.han)) return null
  if (resolved.some((r) => r.han && !r.cands.length)) return null
  const tokens = [] // { cands } per output syllable
  let run = ''
  const flush = () => {
    if (run) tokens.push({ cands: [run], han: false })
    run = ''
  }
  for (const r of resolved) {
    if (r.han) {
      flush()
      tokens.push({ cands: r.cands, han: true })
    } else if (/[\p{L}\p{N}]/u.test(r.ch)) run += r.ch
    else flush()
  }
  flush()
  const cap = (s, t) => (properNoun && t.han ? s.split(' ').map(capitalize).join(' ') : s)
  const first = tokens.map((t) => cap(t.cands[0], t))
  const words = (s) => s.split(' ').length
  const alts = []
  for (let i = 0; i < tokens.length && alts.length < maxAlts; i++) {
    // An alternate keeps the syllable count (圕 thoan, not its gloss-like "đồ thư quán").
    for (const c of tokens[i].cands.slice(1).filter((c) => words(c) === words(tokens[i].cands[0]))) {
      if (alts.length >= maxAlts) break
      const v = [...first]
      v[i] = cap(c, tokens[i])
      alts.push(v.join(' '))
    }
  }
  const nom = resolved.some((r) => r.how === 'unihan')
  const low = nom || resolved.some((r) => r.how === 'other-reading')
  const table = resolved.filter((r) => r.how === 'char-table')
  const curated = table.length ? (table.some((r) => r.status !== 'reviewed') ? 'ai-draft' : 'reviewed') : null
  return { hv: first.join(' '), alts, low, nom, curated }
}
