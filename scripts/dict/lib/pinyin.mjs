// CC-CEDICT numbered pinyin ("xue2 sheng5", "Lu:4", "r5") ↔ tone marks, and the small helpers the
// join, Hán Việt and HSK steps need. Pure functions; unit-tested.

const HAN = /\p{Script=Han}/u
export const isHan = (ch) => HAN.test(ch)

/** Combining marks for tones 1–4 (tone 5, the neutral tone, has none). */
const MARK = { 1: '\u0304', 2: '\u0301', 3: '\u030C', 4: '\u0300' }
const TONE_OF_MARK = { '\u0304': 1, '\u0301': 2, '\u030C': 3, '\u0300': 4 }

/** A pinyin syllable with its tone digit: letters (u: for ü) then 1–5. */
const SYLLABLE = /^([A-Za-zÜüÊê:]+)([1-5])$/

export const syllables = (py) => py.trim().split(/\s+/).filter(Boolean)

/** Tone of a numbered syllable (1–5), or 0 for a token that is not one ("C", "·", ","). */
export function toneOf(token) {
  const m = SYLLABLE.exec(token)
  return m ? Number(m[2]) : 0
}

/** Whether a numbered syllable is written with a capital (CC-CEDICT's proper-noun convention). */
export const isCapitalized = (token) => toneOf(token) > 0 && /^[A-ZÜÊ]/.test(token)

/**
 * One numbered syllable to tone marks: "lu:4" → "lǜ", "Xue2" → "Xué", "r5" → "r". The mark goes on
 * a or e, else on the o of "ou", else on the last vowel. Tokens that are not syllables pass through.
 */
export function syllableToMarks(token) {
  const m = SYLLABLE.exec(token)
  if (!m) return token
  const letters = m[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü')
  const tone = Number(m[2])
  if (tone === 5) return letters
  const lower = letters.toLowerCase()
  let at = lower.search(/[ae]/)
  if (at < 0) at = lower.indexOf('ou')
  if (at < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouüê'.includes(lower[i])) {
        at = i
        break
      }
    }
  }
  if (at < 0) return letters // no vowel ("m2", "ng2"): keep the letters
  return (letters.slice(0, at + 1) + MARK[tone] + letters.slice(at + 1)).normalize('NFC')
}

/** Numbered pinyin of a whole entry to tone marks, syllables separated by spaces. */
export const pinyinMarks = (py) => syllables(py).map(syllableToMarks).join(' ')

/**
 * One tone-marked syllable (Unihan kMandarin / kHanyuPinlu style) to CC-CEDICT numbered form:
 * "liǎo" → "liao3", "lǜ" → "lu:4", "de" → "de5".
 */
export function marksToNumbered(syl) {
  let tone = 5
  let out = ''
  for (const ch of syl.normalize('NFD')) {
    if (TONE_OF_MARK[ch]) tone = TONE_OF_MARK[ch]
    else if (ch === '\u0308') out += ':'
    else out += ch
  }
  return out.normalize('NFC') + tone
}

/** Lowercase, tone digits removed, syllables still space-separated ("Xi1 an1" → "xi an"). */
export const toneless = (py) => py.toLowerCase().replace(/[1-5]/g, '')

/**
 * The whole reading as one lowercase tone-marked string without separators ("zhong1 yi1" →
 * "zhōngyī"), the form HSK lists print; `looseMarked` does the same to such a list's text.
 */
export const markedKey = (py) => looseMarked(syllables(py).map(syllableToMarks).join(''))
export const looseMarked = (text) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s'’\-·∥]/g, '')

/** Number of Han characters in a string (code points, not UTF-16 units). */
export const hanCount = (s) => [...s].filter(isHan).length

/** Whether every code point of a headword is a Han character. */
export const allHan = (s) => {
  const cps = [...s]
  return cps.length > 0 && cps.every(isHan)
}
