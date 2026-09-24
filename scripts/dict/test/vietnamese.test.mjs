import { describe, expect, it } from 'vitest'
import { capitalize, isVietnameseSyllable, normalizeHvSyllable, normalizeViText, oldStyleTones } from '../lib/vietnamese.mjs'

describe('oldStyleTones', () => {
  it('moves the mark of a final oa / oe / uy to the second vowel', () => {
    expect(oldStyleTones('hòa bình')).toBe('hoà bình')
    expect(oldStyleTones('khỏe mạnh')).toBe('khoẻ mạnh')
    expect(oldStyleTones('thủy, Hòa')).toBe('thuỷ, Hoà')
    expect(oldStyleTones('tùy')).toBe('tuỳ')
  })

  it('leaves syllables whose mark is already fixed', () => {
    for (const s of ['hoàn', 'quý', 'huýt', 'thuở', 'hoà', 'khoẻ', 'loá']) expect(oldStyleTones(s)).toBe(s)
    expect(oldStyleTones('guò huà (pinyin)')).toBe('guò huà (pinyin)')
  })

  it('returns NFC from decomposed input', () => {
    expect(oldStyleTones('hòa'.normalize('NFD'))).toBe('hoà'.normalize('NFC'))
  })
})

describe('normalizeHvSyllable', () => {
  it('lowercases and writes y as the whole rhyme after h, k, l, m, t', () => {
    expect(normalizeHvSyllable('Lí')).toBe('lý')
    expect(normalizeHvSyllable('ti')).toBe('ty')
    expect(normalizeHvSyllable('kì')).toBe('kỳ')
    expect(normalizeHvSyllable('mĩ')).toBe('mỹ')
    expect(normalizeHvSyllable('hi')).toBe('hy')
  })

  it('keeps i elsewhere', () => {
    for (const s of ['thi', 'khi', 'phi', 'chi', 'nhi', 'vi', 'di', 'sĩ', 'nghi']) expect(normalizeHvSyllable(s)).toBe(s)
  })

  it('applies hoà-style marks too', () => {
    expect(normalizeHvSyllable('thụy')).toBe('thuỵ')
  })
})

describe('text helpers', () => {
  it('normalizeViText collapses spaces', () => {
    expect(normalizeViText('  một   hai ')).toBe('một hai')
  })

  it('capitalize handles đ', () => {
    expect(capitalize('đài')).toBe('Đài')
    expect(capitalize('bắc')).toBe('Bắc')
  })
})

describe('isVietnameseSyllable', () => {
  it('accepts the shapes of Vietnamese syllables', () => {
    for (const s of ['lãnh', 'độc', 'giác', 'quyển', 'nguyễn', 'thuỵ', 'khuỷu', 'ươn', 'nghĩ', 'Hán', 'a', 'y']) expect(isVietnameseSyllable(s), s).toBe(true)
  })

  it('rejects junk, typos and two tone marks', () => {
    for (const s of ['xyz', 'abc', 'lanhh', 'q', '', 'lấạ', 'dog', 'ph']) expect(isVietnameseSyllable(s), s).toBe(false)
  })
})
