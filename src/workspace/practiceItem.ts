import { pickCharRow } from '../dict/mainForm'
import { parseKey } from '../dict/row'
import { parseSense, plainSense } from '../dict/senses'
import type { CharInfo, DictEntry } from '../dict/types'

/**
 * What the practice workspace is given to practise: a character, what the dictionary says about it
 * (the reading and meaning its prompt shows), and the word it was learned in. The workspace does not
 * know where the item came from — a review session or free practice.
 */

export type Script = 'simplified' | 'traditional' | 'both'

export interface PracticeInfo {
  /** CC-CEDICT numbered pinyin of the reading shown ('xue2'); '' when unknown. */
  pinyin: string
  /** Âm Hán Việt of that reading; '' when unknown. */
  hanViet: string
  /** One or two short senses, most important first. */
  meanings: string[]
  /** The senses are English: the dictionary has no Vietnamese for this character. */
  english: boolean
  script: Script
  /** The same character in the other script (学 ↔ 學), or null. */
  counterpart: string | null
}

/** The word a card was added from (a deck card's context). */
export interface PracticeContext {
  key: string
  simp: string
  /** The word's numbered pinyin. */
  pinyin: string
  /** Its first sense. */
  vi: string
  /**
   * The word is a proper noun (中国 Zhong1 guo2): its capital names the word, not the character, so
   * the character's lowercase row is meant. Otherwise a capitalized syllable asks for the name row
   * (汉 in 汉语 Han4 yu3 is the Han people, not han4 "đàn ông").
   */
  pn?: boolean
}

export interface PracticeItem {
  char: string
  /** null while the dictionary loads ('loading') or when it has nothing on the character ('none'). */
  info: PracticeInfo | null
  infoStatus: 'loading' | 'ready' | 'none'
  context: PracticeContext | null
}

/** The part of the dictionary's CharInfo the mapping reads (a test double needs no more). */
export interface CharInfoLike {
  script: CharInfo['script']
  counterpart: string | null
  entries: readonly Pick<DictEntry, 'key' | 'simp' | 'trad' | 'pinyin' | 'hv' | 'vi' | 'en' | 'flags'>[]
}

const CLASSIFIER = /^\s*(?:lượng từ|lt|cl)\s*:/i

/**
 * The prompt's information for `char`: its row in the context word when there is one — the word's
 * traditional form of it and its reading there (发 in 头发 is 髮 fà "tóc", not 發 fā "gửi"; 行 in
 * 银行 is háng) — else its most common row; the first one or two senses of that row (Vietnamese,
 * else English); script and counterpart. The row is chosen as the entry page's character cards
 * choose it (dict/mainForm.ts). Without dictionary data, the reading the context word gives, if any.
 */
export function practiceInfo(info: CharInfoLike | null, char: string, context: PracticeContext | null): PracticeInfo | null {
  const reading = context ? readingInWord(char, context) : null
  const entry = info?.entries.length
    ? pickCharRow(info.entries, char, { trad: context ? tradInWord(char, context) : null, syllable: reading, exactCase: !context?.pn })
    : null
  if (!info || !entry) {
    if (!reading) return null
    return { pinyin: reading, hanViet: '', meanings: [], english: false, script: info?.script ?? 'both', counterpart: info?.counterpart ?? null }
  }
  const vi = topSenses(entry.vi, 2)
  const meanings = vi.length ? vi : topSenses(entry.en, 2)
  return {
    pinyin: entry.pinyin,
    hanViet: entry.hv === '-' ? '' : entry.hv,
    meanings,
    english: vi.length === 0 && meanings.length > 0,
    script: info.script,
    counterpart: info.counterpart,
  }
}

/** The numbered syllable `char` has in the word (CC-CEDICT writes one syllable per character), or null. */
export function readingInWord(char: string, context: Pick<PracticeContext, 'simp' | 'pinyin'>): string | null {
  const chars = [...context.simp]
  const syllables = context.pinyin.trim().split(/\s+/)
  const i = chars.indexOf(char)
  if (i < 0 || chars.length !== syllables.length) return null
  return syllables[i] || null
}

/** The traditional form `char` has in the word (its key says: 頭髮|头发 → 髮 for 发), or null. */
export function tradInWord(char: string, context: Pick<PracticeContext, 'key' | 'simp'>): string | null {
  const trad = parseKey(context.key)?.trad
  const chars = [...context.simp]
  const i = chars.indexOf(char)
  if (!trad || i < 0) return null
  const trads = [...trad]
  return trads.length === chars.length ? trads[i] : null
}

/**
 * The first `n` distinct senses worth a prompt line: no classifier lines, as plainSense shows them
 * (a short note that narrows a word kept). Two senses that differ only in their notes are one.
 */
export function topSenses(senses: readonly string[], n: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of senses) {
    if (CLASSIFIER.test(s)) continue
    const text = plainSense(s)
    const bare = withoutNotes(s)
    if (!text || seen.has(bare)) continue
    seen.add(bare)
    out.push(text)
    if (out.length === n) break
  }
  return out
}

/** A sense's text without any note, spaces collapsed: what two senses are compared on. */
function withoutNotes(sense: string): string {
  return parseSense(sense)
    .spans.filter((sp) => !sp.note)
    .flatMap((sp) => sp.parts)
    .map((p) => (p.kind === 'ref' ? p.hanzi : p.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
