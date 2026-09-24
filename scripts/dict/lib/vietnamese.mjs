// Vietnamese spelling normalization, applied once at build so every row reads the same way.
// Pure; unit-tested.

const TONE = '[\\u0300\\u0301\\u0303\\u0309\\u0323]' // huyền, sắc, ngã, hỏi, nặng (NFD)
const NOT_LETTER = '(?![\\p{L}\\p{M}])'
/** "hòa" → "hoà", "khỏe" → "khoẻ" (mark on the second vowel of a final oa / oe). */
const OA_OE = new RegExp(`([oO])(${TONE})([aAeE])${NOT_LETTER}`, 'gu')
/** "thủy" → "thuỷ" (final uy; "quý" is qu + y and keeps its mark). */
const UY = new RegExp(`(?<![qQ])([uU])(${TONE})([yY])${NOT_LETTER}`, 'gu')

/**
 * One tone-mark placement for open oa / oe / uy: the older "hoà" style, which both CVDICT (hoà 1,716
 * vs hòa 582) and the Hán Việt word list (hoà-style only) mostly use. Returns NFC.
 */
export function oldStyleTones(text) {
  return text.normalize('NFD').replace(OA_OE, '$1$3$2').replace(UY, '$1$3$2').normalize('NFC')
}

/** NFC, whitespace collapsed, tone marks in one placement. */
export const normalizeViText = (text) => oldStyleTones(text.normalize('NFC').replace(/\s+/g, ' ').trim())

/**
 * One Hán Việt syllable in the dictionary's spelling: lowercase NFC, hoà-style tone marks, and y (not
 * i) as the whole rhyme after h, k, l, m, t (hy, kỳ, lý, mỹ, ty) — the convention the word list
 * mostly follows (ty 53 vs ti 12, ly 41 vs li 7) and the curated overrides use (công ty).
 */
export function normalizeHvSyllable(syl) {
  const lower = oldStyleTones(syl.normalize('NFC').trim().toLowerCase())
  const d = lower.normalize('NFD')
  const m = new RegExp(`^([hklmt])i(${TONE}?)$`, 'u').exec(d)
  return m ? `${m[1]}y${m[2]}`.normalize('NFC') : lower
}

const ONSET = '(?:ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdđghklmnprstvx])?'
const RHYME = '[aăâeêioôơuưy]{1,3}(?:ch|ng|nh|[cmnpt])?'
const SYLLABLE_SHAPE = new RegExp(`^${ONSET}${RHYME}$`, 'u')
const TONE_MARKS = /[̣̀́̃̉]/g

/**
 * Whether a curated reading has the shape of one Vietnamese syllable (onset, one to three vowels,
 * a final consonant; at most one tone mark). Catches typos and junk in a curated file ("xyz"), not
 * wrong readings: a character's true reading may be missing from every source the build has.
 */
export function isVietnameseSyllable(syl) {
  const d = syl.normalize('NFC').toLowerCase().normalize('NFD')
  if ((d.match(TONE_MARKS) ?? []).length > 1) return false
  return SYLLABLE_SHAPE.test(d.replace(TONE_MARKS, '').normalize('NFC'))
}

/** Capitalizes a syllable's first letter (Đ included): proper-noun readings, "Bắc Kinh". */
export const capitalize = (syl) => (syl ? syl[0].toUpperCase() + syl.slice(1) : syl)
