/**
 * Vietnamese text as the search sees it (Hán Việt readings and meanings).
 *
 * - fold: lowercase, every diacritic removed, đ → d — what people type without a Vietnamese keyboard.
 * - i/y: kỳ/kì, lý/lí, mỹ/mĩ are the same word in two spellings; a syllable that is a consonant (or
 *   none) + y is folded to i. Not uy (thuỷ ≠ thui) and not y inside a syllable (yêu, quyết).
 * - toneKey: keeps the letters' own marks (â ê ô ơ ư ă đ) and turns the tone into a digit per syllable,
 *   so hoà and hòa, kỳ and kì compare equal — for "the learner typed diacritics: do they match?".
 *
 * Pure; the fold uses a lookup table because it runs over every meaning while the index is built.
 */

/** Folded code unit per UTF-16 code unit below 0x2000: 0 = separator, SKIP = drop (combining mark). */
const FOLD = new Uint16Array(0x2000)
const SKIP = 0xffff

for (let c = 0; c < 0x2000; c++) {
  if ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a)) FOLD[c] = c
  else if (c >= 0x41 && c <= 0x5a) FOLD[c] = c + 32
  else if (c >= 0x300 && c <= 0x36f) FOLD[c] = SKIP
  else if (c >= 0xc0) {
    const base = String.fromCharCode(c).normalize('NFD').charCodeAt(0)
    const low = base >= 0x41 && base <= 0x5a ? base + 32 : base
    if (low >= 0x61 && low <= 0x7a) FOLD[c] = low
  }
}
FOLD[0x110] = FOLD[0x111] = 0x64 // Đ đ → d

/** The folded letter or digit for a code unit, 0 for a separator, SKIP for a combining mark. */
export function foldCode(c: number): number {
  return c < 0x2000 ? FOLD[c] : 0
}
export const FOLD_SKIP = SKIP

/** Lowercase, no diacritics, đ → d; other characters (spaces, punctuation, hanzi) kept as they are. */
export function fold(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const f = c < 0x2000 ? FOLD[c] : 0
    if (f === SKIP) continue
    out += f ? String.fromCharCode(f) : s[i].toLowerCase()
  }
  return out
}

const Y_ONSETS = new Set(['', 'b', 'c', 'd', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x'])
const Y_ONSETS_2 = new Set(['ch', 'gh', 'kh', 'ng', 'nh', 'ph', 'th', 'tr', 'qu'])

/** i/y folding of one folded syllable: ky → ki, ly → li, my → mi, quy → qui, y → i; thuy, yeu kept. */
export function foldIY(syllable: string): string {
  const n = syllable.length
  if (n === 0 || syllable.charCodeAt(n - 1) !== 0x79) return syllable
  const onset = syllable.slice(0, -1)
  if (Y_ONSETS.has(onset) || Y_ONSETS_2.has(onset) || onset === 'ngh') return onset + 'i'
  return syllable
}

/**
 * The search key of a phrase: folded words (letters and digits) with i/y folding, joined by single
 * spaces; everything else separates words. 'Học  sinh!' → 'hoc sinh', 'Kỳ' → 'ki'.
 */
export function foldKey(s: string): string {
  const words: string[] = []
  let w = ''
  for (let i = 0; i <= s.length; i++) {
    const f = i < s.length ? foldCode(s.charCodeAt(i)) : 0
    if (f === SKIP) continue
    if (f) {
      w += String.fromCharCode(f)
      continue
    }
    if (w) words.push(foldIY(w))
    w = ''
  }
  return words.join(' ')
}

/** Vietnamese tone marks (huyền, sắc, ngã, hỏi, nặng) → digit 2..6; 1 = ngang (none). */
const VI_TONES: Record<string, number> = { '\u0300': 2, '\u0301': 3, '\u0303': 4, '\u0309': 5, '\u0323': 6 }

/**
 * Letters with their own marks, tone as a digit per syllable, i/y folded, lowercase: 'Hoà' and 'hòa'
 * → 'hoa2', 'kỳ' and 'kì' → 'ki2', 'ăn' → 'ăn1'. Words are joined by single spaces.
 */
export function toneKey(s: string): string {
  const words: string[] = []
  for (const raw of s.normalize('NFD').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!raw) continue
    let tone = 1
    let base = ''
    for (const ch of raw) {
      const t = VI_TONES[ch]
      if (t) tone = t
      else base += ch
    }
    base = base.normalize('NFC')
    // i/y on the folded form, but only when the syllable really is consonant + y.
    const folded = fold(base)
    if (folded !== foldIY(folded) && base.endsWith('y')) base = base.slice(0, -1) + 'i'
    words.push(base + tone)
  }
  return words.join(' ')
}

/** Marks that Vietnamese uses but pinyin never does: tilde, hook, dot below, horn, circumflex, breve, đ. */
const VI_ONLY = /[\u0303\u0309\u0323\u031b\u0302\u0306]|đ/i

/** True if the text can only be Vietnamese (not pinyin). */
export function isVietnameseOnly(s: string): boolean {
  return VI_ONLY.test(s.normalize('NFD'))
}

/** Marks that pinyin uses but Vietnamese never does: macron, caron, diaeresis (ü); a tone digit after a letter. */
const PINYIN_ONLY = /[\u0304\u030c\u0308]|[a-z][0-5]|u:/i

/** True if the text can only be pinyin (not Vietnamese). */
export function isPinyinOnly(s: string): boolean {
  return PINYIN_ONLY.test(s.normalize('NFD'))
}

/** True if the text has any diacritic or đ (the learner typed Vietnamese marks, or tone marks). */
export function hasDiacritics(s: string): boolean {
  return /[\u0300-\u036f]|đ/i.test(s.normalize('NFD'))
}
