import { describe, expect, it } from 'vitest'
import {
  allHan,
  hanCount,
  isCapitalized,
  looseMarked,
  markedKey,
  marksToNumbered,
  pinyinMarks,
  syllableToMarks,
  syllables,
  toneOf,
  toneless,
} from '../lib/pinyin.mjs'

describe('numbered pinyin → tone marks', () => {
  it('puts the mark on a or e, else the o of ou, else the last vowel', () => {
    expect(syllableToMarks('hao3')).toBe('hǎo')
    expect(syllableToMarks('xue2')).toBe('xué')
    expect(syllableToMarks('dou1')).toBe('dōu')
    expect(syllableToMarks('liu4')).toBe('liù')
    expect(syllableToMarks('gui4')).toBe('guì')
    expect(syllableToMarks('er4')).toBe('èr')
  })

  it('writes u: as ü, keeps capitals, drops the neutral tone digit', () => {
    expect(syllableToMarks('lu:4')).toBe('lǜ')
    expect(syllableToMarks('nu:3')).toBe('nǚ')
    expect(syllableToMarks('lu:e4')).toBe('lüè')
    expect(syllableToMarks('Xi1')).toBe('Xī')
    expect(syllableToMarks('sheng5')).toBe('sheng')
    expect(syllableToMarks('r5')).toBe('r')
  })

  it('passes through tokens that are not syllables', () => {
    expect(syllableToMarks('C')).toBe('C')
    expect(syllableToMarks('·')).toBe('·')
    expect(pinyinMarks('san1 C')).toBe('sān C')
    expect(pinyinMarks('xue2 sheng5')).toBe('xué sheng')
    expect(pinyinMarks('Xi1  an1')).toBe('Xī ān')
  })

  it('returns NFC', () => {
    const s = pinyinMarks('nu:3 er2')
    expect(s).toBe(s.normalize('NFC'))
  })
})

describe('tone marks → numbered', () => {
  it('reads Unihan-style syllables', () => {
    expect(marksToNumbered('liǎo')).toBe('liao3')
    expect(marksToNumbered('lǜ')).toBe('lu:4')
    expect(marksToNumbered('de')).toBe('de5')
    expect(marksToNumbered('zhōng')).toBe('zhong1')
  })

  it('round-trips with syllableToMarks', () => {
    for (const s of ['ma1', 'ma2', 'ma3', 'ma4', 'lu:e4', 'guo2', 'nu:3']) expect(marksToNumbered(syllableToMarks(s))).toBe(s)
  })
})

describe('helpers', () => {
  it('splits syllables and reads tones', () => {
    expect(syllables(' xue2  sheng5 ')).toEqual(['xue2', 'sheng5'])
    expect(toneOf('xue2')).toBe(2)
    expect(toneOf('C')).toBe(0)
    expect(toneless('Xi1 an1')).toBe('xi an')
  })

  it('detects CC-CEDICT proper-noun capitals only on real syllables', () => {
    expect(isCapitalized('Bei3')).toBe(true)
    expect(isCapitalized('bei3')).toBe(false)
    expect(isCapitalized('C')).toBe(false)
  })

  it('compares with HSK-list pinyin written without separators', () => {
    expect(markedKey('zhong1 yi1')).toBe('zhōngyī')
    expect(looseMarked('zhōngyī')).toBe('zhōngyī')
    expect(markedKey('shi4 bu5 shi4')).toBe(looseMarked('shì bu shì'))
    expect(markedKey('nan2 yi3 xiang3 xiang4')).toBe(looseMarked('nányǐ-xiǎngxiàng'))
  })

  it('counts Han characters by code point', () => {
    expect(hanCount('卡拉OK')).toBe(2)
    expect(hanCount('𠀀a')).toBe(1)
    expect(allHan('学生')).toBe(true)
    expect(allHan('3C')).toBe(false)
    expect(allHan('〇')).toBe(true)
  })
})
