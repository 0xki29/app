/**
 * Pinyin: display (CC-CEDICT numbered pinyin → tone marks, per-syllable tones for coloring) and search
 * (free-form typed pinyin → a toneless key plus the tones and syllable boundaries the learner typed).
 *
 * Pure functions; shared by the dictionary (index, worker, screens) and the practice prompt.
 */

export type Tone = 1 | 2 | 3 | 4 | 5

export interface PinyinSyllable {
  /** With its tone mark, e.g. 'xué'; an erhua 'r5' is joined to the syllable before it ('diǎnr'). */
  text: string
  /** 5 = neutral tone — also used for anything that is not a toned syllable (a Latin letter, '·'). */
  tone: Tone
  /** Written without a space before it: the second syllable of one character read as two (瓩 qiānwǎ). */
  joined?: true
}

/** Combining marks for tones 1–4 (macron, acute, caron, grave). */
const TONE_MARKS = ['\u0304', '\u0301', '\u030c', '\u0300'] as const

/** A token made only of numbered syllables: 'xue2', 'Lu:4', 'shi2ke4' (one character read as two). */
const NUMBERED_TOKEN = /^(?:[a-zü:^]+[1-5])+$/i
const NUMBERED_SYLLABLE = /([a-zü:^]+?)([1-5])/gi

/**
 * One syllable with its tone mark. Standard placement: on a or e if present, on the o of ou, else
 * on the last vowel (so liù, duì); a syllabic m or n (呣 m2, 嗯 ng2) takes it on the m or n.
 */
export function markSyllable(letters: string, tone: Tone): string {
  const s = letters
    .replace(/u:|v/g, 'ü')
    .replace(/U:|V/g, 'Ü')
    .replace(/e\^/g, 'ê')
    .replace(/E\^/g, 'Ê')
  if (tone === 5) return s
  const low = s.toLowerCase()
  let at = low.indexOf('a')
  if (at < 0) at = low.search(/[eê]/)
  if (at < 0) at = low.indexOf('ou')
  if (at < 0) {
    for (let k = low.length - 1; k >= 0; k--) {
      if ('iouü'.includes(low[k])) {
        at = k
        break
      }
    }
  }
  if (at < 0) at = low.search(/[mn]/)
  if (at < 0) return s
  return (s.slice(0, at + 1) + TONE_MARKS[tone - 1] + s.slice(at + 1)).normalize('NFC')
}

/**
 * CC-CEDICT numbered pinyin → display syllables with tones, in order.
 *   'xue2 sheng5' → [{ xué, 2 }, { sheng, 5 }]      'Xi1 an1' → [{ Xī, 1 }, { ān, 1 }]
 *   'nu:3 er2'   → [{ nǚ, 3 }, { ér, 2 }]           'yi1 dian3 r5' → [{ yī, 1 }, { diǎnr, 3 }]
 * Capitals are kept (proper nouns). Tokens that are not numbered syllables (a Latin letter in AA制,
 * '·' between the parts of a foreign name, ',') pass through unchanged with tone 5.
 */
export function pinyinSyllables(numbered: string): PinyinSyllable[] {
  const out: PinyinSyllable[] = []
  /** Whether the last item pushed is a toned syllable (an erhua -r can join it). */
  let lastIsSyllable = false
  for (const token of numbered.trim().split(/\s+/)) {
    if (!token) continue
    if (!NUMBERED_TOKEN.test(token)) {
      out.push({ text: token, tone: 5 })
      lastIsSyllable = false
      continue
    }
    let first = true
    for (const m of token.matchAll(NUMBERED_SYLLABLE)) {
      const tone = Number(m[2]) as Tone
      // Erhua: 儿 read as a bare -r belongs to the syllable before it (一点儿 yīdiǎnr, not "diǎn r").
      if (lastIsSyllable && tone === 5 && m[1].toLowerCase() === 'r') {
        out[out.length - 1].text += m[1]
        continue
      }
      out.push(first ? { text: markSyllable(m[1], tone), tone } : { text: markSyllable(m[1], tone), tone, joined: true })
      lastIsSyllable = true
      first = false
    }
  }
  return out
}

/** CC-CEDICT numbered pinyin → tone marks, syllables separated by spaces: 'xue2 sheng5' → 'xué sheng'. */
export function pinyinMarks(numbered: string): string {
  return pinyinSyllables(numbered)
    .map((s, i) => (i === 0 || s.joined ? s.text : ` ${s.text}`))
    .join('')
}

/** Numbered syllables of an entry, one per token syllable, lowercase, ü as 'v': for per-character use. */
export function numberedSyllables(numbered: string): { letters: string; tone: Tone | 0 }[] {
  const out: { letters: string; tone: Tone | 0 }[] = []
  for (const token of numbered.toLowerCase().trim().split(/\s+/)) {
    for (const m of token.matchAll(/([a-zü:^]+)([1-5]?)/g)) {
      out.push({ letters: m[1].replace(/u:|ü/g, 'v').replace('^', ''), tone: m[2] ? (Number(m[2]) as Tone) : 0 })
    }
  }
  return out
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * An entry's pinyin as the index sees it: toneless letters joined ('xuesheng', ü as 'v'), where each
 * syllable ends, and its tone (0 = a letter with no tone, e.g. the A of AA制). Punctuation and digits
 * are skipped.
 */
export interface PinyinKey {
  key: string
  ends: number[]
  tones: (Tone | 0)[]
}

export function pinyinKey(numbered: string): PinyinKey {
  let key = ''
  const ends: number[] = []
  const tones: (Tone | 0)[] = []
  for (const s of numberedSyllables(numbered)) {
    key += s.letters
    ends.push(key.length)
    tones.push(s.tone)
  }
  return { key, ends, tones }
}

/**
 * What the learner typed, as pinyin: the toneless key, tones typed as marks (position of the marked
 * letter) or digits (position after the syllable), and the boundaries typed as spaces, apostrophes,
 * hyphens or digits. Accepts 'xuéshēng', 'xue2sheng1', 'xue sheng', "xi'an", 'lü4', 'lu:4', 'lv4',
 * 'nü' / 'nv'; 0 is taken for the neutral tone like 5. `null` if it cannot be pinyin.
 */
export interface PinyinQuery {
  key: string
  /** [index of the marked letter in key, tone] */
  marks: [number, Tone][]
  /** [key length where the digit was typed, tone] */
  digits: [number, Tone][]
  /** key lengths where a syllable boundary was typed (never 0 or key.length) */
  bounds: number[]
}

const QUERY_TONE_MARK: Record<string, Tone> = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 }

export function parsePinyinQuery(q: string): PinyinQuery | null {
  let key = ''
  const marks: [number, Tone][] = []
  const digits: [number, Tone][] = []
  const bounds: number[] = []
  const s = q.normalize('NFD').toLowerCase()
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch >= 'a' && ch <= 'z') key += ch
    else if (ch in QUERY_TONE_MARK) {
      if (key) marks.push([key.length - 1, QUERY_TONE_MARK[ch]])
    } else if (ch === '\u0308' || (ch === ':' && key.endsWith('u'))) {
      if (key.endsWith('u')) key = key.slice(0, -1) + 'v'
    } else if (ch >= '0' && ch <= '5') {
      if (key) {
        digits.push([key.length, ch === '0' ? 5 : (Number(ch) as Tone)])
        bounds.push(key.length)
      }
    } else if (ch === ' ' || ch === "'" || ch === '\u2019' || ch === '-') {
      if (key) bounds.push(key.length)
    } else return null
  }
  if (!key) return null
  return { key, marks, digits, bounds: [...new Set(bounds)].filter((b) => b < key.length) }
}

/** True if the query typed any tone or boundary (then it is checked syllable by syllable). */
export function isConstrained(pq: PinyinQuery): boolean {
  return pq.marks.length + pq.digits.length + pq.bounds.length > 0
}

/**
 * How an entry's syllables meet the typed tones and boundaries: 0 = they do not; 1 = only thanks to
 * a neutral tone (or a toneless letter) in the entry, which matches any typed tone — 学生 is
 * xue2 sheng5 in the dictionary, but learners type xuéshēng; 2 = every typed tone matches.
 */
export function pinyinMatch(pq: PinyinQuery, syl: PinyinKey): 0 | 1 | 2 {
  let exact: 1 | 2 = 2
  const toneOk = (i: number, want: Tone): boolean => {
    const t = syl.tones[i]
    if (t === want) return true
    if (t === 5 || t === 0) {
      exact = 1
      return true
    }
    return false
  }
  for (const b of pq.bounds) if (!syl.ends.includes(b)) return 0
  for (const [end, t] of pq.digits) {
    const i = syl.ends.indexOf(end)
    if (i < 0 || !toneOk(i, t)) return 0
  }
  for (const [pos, t] of pq.marks) {
    const i = syl.ends.findIndex((e) => pos < e)
    if (i < 0 || !toneOk(i, t)) return 0
  }
  return exact
}
