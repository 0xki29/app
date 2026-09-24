import { describe, expect, it } from 'vitest'
import {
  markSyllable,
  numberedSyllables,
  parsePinyinQuery,
  pinyinKey,
  pinyinMarks,
  pinyinMatch,
  pinyinSyllables,
} from './pinyin'

describe('pinyinMarks', () => {
  it.each([
    ['xue2 sheng5', 'xué sheng'],
    ['ni3 hao3', 'nǐ hǎo'],
    ['Xi1 an1', 'Xī ān'],
    ['Zhong1 guo2', 'Zhōng guó'],
    ['nu:3 er2', 'nǚ ér'],
    ['lu:4', 'lǜ'],
    ['lv4', 'lǜ'],
    ['Lu:3', 'Lǚ'],
    ['nu:e4', 'nüè'],
    ['xie4 xie5', 'xiè xie'],
    ['liu4', 'liù'], // iu: the last vowel
    ['dui4', 'duì'], // ui: the last vowel
    ['gou3', 'gǒu'], // ou: the o
    ['guo2', 'guó'],
    ['hao3', 'hǎo'], // a first
    ['mei2', 'méi'], // e before i
    ['er4', 'èr'],
    ['m2', 'ḿ'],
    ['ng2', 'ńg'],
    ['hm5', 'hm'],
    ['hng5', 'hng'],
    ['A A zhi4', 'A A zhì'],
    ['Ka3 er3 · Ma3 ke4 si1', 'Kǎ ěr · Mǎ kè sī'],
    ['shi2ke4', 'shíkè'],
  ])('%s → %s', (numbered, marked) => {
    expect(pinyinMarks(numbered)).toBe(marked)
  })

  it('joins an erhua -r to the syllable before it', () => {
    expect(pinyinMarks('yi1 dian3 r5')).toBe('yī diǎnr')
    expect(pinyinMarks('na3 r5')).toBe('nǎr')
    expect(pinyinSyllables('yi1 dian3 r5')).toEqual([
      { text: 'yī', tone: 1 },
      { text: 'diǎnr', tone: 3 },
    ])
    // 儿 as a syllable of its own is not erhua
    expect(pinyinMarks('er2 zi5')).toBe('ér zi')
    // an r after a non-syllable (a Latin letter) stays apart
    expect(pinyinMarks('A r5')).toBe('A r')
  })

  it('gives each syllable its tone, 5 for neutral and for non-syllables', () => {
    expect(pinyinSyllables('xue2 sheng5')).toEqual([
      { text: 'xué', tone: 2 },
      { text: 'sheng', tone: 5 },
    ])
    expect(pinyinSyllables('A A zhi4').map((s) => s.tone)).toEqual([5, 5, 4])
  })

  it('returns NFC text', () => {
    for (const s of ['lu:4', 'nu:3', 'm2', 'xue2']) {
      const t = pinyinMarks(s)
      expect(t).toBe(t.normalize('NFC'))
    }
    expect(markSyllable('lu:', 3)).toBe('lǚ')
  })
})

describe('numberedSyllables / pinyinKey', () => {
  it('aligns one syllable per character, ü as v', () => {
    expect(numberedSyllables('nu:3 er2')).toEqual([
      { letters: 'nv', tone: 3 },
      { letters: 'er', tone: 2 },
    ])
    expect(pinyinKey('Xue2 sheng5 t jian3')).toEqual({ key: 'xueshengtjian', ends: [3, 8, 9, 13], tones: [2, 5, 0, 3] })
    expect(pinyinKey('Ka3 er3 · Ma3').key).toBe('kaerma')
  })
})

describe('parsePinyinQuery', () => {
  it('reads tone marks, digits, boundaries and ü spellings', () => {
    expect(parsePinyinQuery('xuéshēng')).toEqual({ key: 'xuesheng', marks: [[2, 2], [5, 1]], digits: [], bounds: [] })
    expect(parsePinyinQuery('xue2sheng1')).toEqual({ key: 'xuesheng', marks: [], digits: [[3, 2], [8, 1]], bounds: [3] })
    expect(parsePinyinQuery('xue sheng')?.bounds).toEqual([3])
    expect(parsePinyinQuery("xi'an")?.bounds).toEqual([2])
    expect(parsePinyinQuery('lü4')?.key).toBe('lv')
    expect(parsePinyinQuery('lu:4')?.key).toBe('lv')
    expect(parsePinyinQuery('lv4')?.key).toBe('lv')
    expect(parsePinyinQuery('ma0')?.digits).toEqual([[2, 5]])
    expect(parsePinyinQuery('XUE')?.key).toBe('xue')
  })

  it('is null for what cannot be pinyin', () => {
    expect(parsePinyinQuery('học sinh')).toBeNull()
    expect(parsePinyinQuery('đi')).toBeNull()
    expect(parsePinyinQuery('123')).toBeNull()
    expect(parsePinyinQuery('学')).toBeNull()
  })
})

describe('pinyinMatch', () => {
  const xuesheng = pinyinKey('xue2 sheng5')
  it('lets a neutral tone in the entry stand for any typed tone', () => {
    expect(pinyinMatch(parsePinyinQuery('xue2sheng1')!, xuesheng)).toBe(1)
    expect(pinyinMatch(parsePinyinQuery('xue2')!, pinyinKey('xue2'))).toBe(2)
    expect(pinyinMatch(parsePinyinQuery('xuéshēng')!, xuesheng)).toBe(1)
  })
  it('rejects a wrong tone and a boundary inside a syllable', () => {
    expect(pinyinMatch(parsePinyinQuery('xue3sheng')!, xuesheng)).toBe(0)
    expect(pinyinMatch(parsePinyinQuery('xu esheng')!, xuesheng)).toBe(0)
    expect(pinyinMatch(parsePinyinQuery("xi'an")!, pinyinKey('Xi1 an1'))).toBe(2)
    expect(pinyinMatch(parsePinyinQuery("xi'an")!, pinyinKey('xian1'))).toBe(0)
  })
})
