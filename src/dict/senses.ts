import { pinyinMarks } from './pinyin'
import { entryKey } from './row'

/**
 * One sense of a meaning, cut into what the entry screen styles differently: plain text, notes in
 * parentheses (usage, register, "vd." examples — shown subtly), runs of hanzi (for the CJK font),
 * cross-references to other entries (瞭|了[liao3] → a link "了 liǎo"), and pinyin in brackets
 * ([di4] → [dì]). A classifier sense ("Lượng từ: 个 (gè)", CC-CEDICT "CL:個|个[ge4]") is flagged.
 */

export type SensePart =
  | { kind: 'text'; text: string }
  | { kind: 'zh'; text: string }
  | { kind: 'ref'; key: string; hanzi: string; trad: string; pinyin: string }
  | { kind: 'pinyin'; text: string }

export interface SenseSpan {
  /** Inside parentheses. */
  note: boolean
  parts: SensePart[]
}

export interface ParsedSense {
  classifier: boolean
  spans: SenseSpan[]
}

const CLASSIFIER = /^\s*(?:lượng từ|lt|cl)\s*:\s*/i
const HANZI = '[\\p{Script=Han}〇]+'
// trad|simp[py] or one form[py]; then a bare [py]; then a run of hanzi
const TOKEN = new RegExp(`(${HANZI})(?:\\|(${HANZI}))?\\[([A-Za-z:]+[1-5]?(?: [A-Za-z:·,]+[1-5]?)*)\\]|\\[([A-Za-z:]+[1-5](?: [A-Za-z:]+[1-5])*)\\]|(${HANZI})`, 'gu')

const HAN_G = /\p{Script=Han}|〇/gu

function parts(text: string): SensePart[] {
  const out: SensePart[] = []
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
    if (m[1]) {
      const trad = m[1]
      const simp = m[2] ?? m[1]
      // A link only when there is one syllable per character: anything else is not an entry key
      // (a phrase with a placeholder, "以…的身份[yi3 xx5 …]") and would open "not found".
      const syllables = m[3].trim().split(/\s+/).filter((t) => t !== '·' && t !== ',')
      if ((simp.match(HAN_G) ?? []).length === syllables.length && !simp.includes('…')) {
        out.push({ kind: 'ref', key: entryKey(simp, trad, m[3]), hanzi: simp, trad, pinyin: pinyinMarks(m[3]) })
      } else out.push({ kind: 'zh', text: simp })
    } else if (m[4]) out.push({ kind: 'pinyin', text: `[${pinyinMarks(m[4])}]` })
    else out.push({ kind: 'zh', text: m[5] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

export function parseSense(sense: string): ParsedSense {
  const cl = CLASSIFIER.exec(sense)
  const body = cl ? sense.slice(cl[0].length) : sense
  const spans: SenseSpan[] = []
  let depth = 0
  let cur = ''
  const flush = (note: boolean) => {
    if (cur) spans.push({ note, parts: parts(cur) })
    cur = ''
  }
  for (const ch of body) {
    if (ch === '(' || ch === '\uff08') {
      if (depth === 0) flush(false)
      depth++
      cur += ch
    } else if ((ch === ')' || ch === '\uff09') && depth > 0) {
      cur += ch
      depth--
      if (depth === 0) flush(true)
    } else cur += ch
  }
  flush(depth > 0)
  return { classifier: !!cl, spans }
}

/** Notes a one-line sense keeps: short ones right after a word, which narrow it ("ăn (tết)"), not examples. */
const KEPT_NOTE_MAX = 24
const EXAMPLE_NOTE = /^[(（]\s*(?:vd\.|ví dụ|=|e\.g\.)/i

/**
 * A sense as plain text for a list row or the deck's context: refs as their hanzi; a leading label
 * ("(sau số đếm) giờ"), "vd." examples and long notes dropped; a short note right after a word kept,
 * since it says which sense is meant ("ăn (tết); đón (lễ)", "lớp (học)").
 */
export function plainSense(sense: string): string {
  const spans = parseSense(sense).spans
  const textOf = (s: SenseSpan) => s.parts.map((p) => (p.kind === 'ref' ? p.hanzi : p.text)).join('')
  return spans
    .filter((s, i) => {
      if (!s.note) return true
      const prev = spans[i - 1]
      const afterWord = !!prev && !prev.note && /[\p{L}\p{N}]\s?$/u.test(textOf(prev))
      const text = textOf(s)
      return afterWord && text.length <= KEPT_NOTE_MAX && !EXAMPLE_NOTE.test(text)
    })
    .map(textOf)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([;,])/g, '$1')
    .replace(/^[\s;,:]+|[\s;,:]+$/g, '')
}

/** The first sense worth showing in a result row: not a classifier line; a note-only sense kept whole. */
export function firstMeaning(senses: readonly string[]): string {
  for (const s of senses) {
    if (CLASSIFIER.test(s)) continue
    return plainSense(s) || s
  }
  return senses[0] ?? ''
}
