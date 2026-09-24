import { describe, expect, it } from 'vitest'
import { mainFormKey, pickCharRow } from './mainForm'

type Row = { key: string; simp: string; trad: string; pinyin: string; vi: string[]; en: string[]; flags: string[] }

const row = (trad: string, simp: string, pinyin: string, vi: string[], flags: string[] = ['mt']): Row => ({
  key: `${trad}|${simp}[${pinyin}]`,
  simp,
  trad,
  pinyin,
  vi,
  en: [],
  flags,
})

// Most common first, as the index lists a character's rows.
const FA = [row('發', '发', 'fa1', ['gửi; gửi đi']), row('髮', '发', 'fa4', ['tóc'])]
const TAI = [
  row('臺', '台', 'tai2', ['bục', 'sân khấu']),
  row('檯', '台', 'tai2', ['bàn; cái bàn']),
  row('颱', '台', 'tai2', ['bão']),
  row('台', '台', 'tai2', ['(văn cổ) ông (trong thư từ)', 'biến thể của 臺|台[tai2]']),
  row('台', '台', 'Tai2', ['Đài Loan (viết tắt)'], ['pn', 'mt']),
]
const HAN = [row('漢', '汉', 'han4', ['đàn ông']), row('漢', '汉', 'Han4', ['dân tộc Hán', 'tiếng Trung Quốc'], ['pn', 'mt'])]

describe('pickCharRow', () => {
  it('takes the row of the word’s traditional form', () => {
    expect(pickCharRow(FA, '发', { trad: '髮', syllable: 'fa5' })?.key).toBe('髮|发[fa4]') // 头发 tóu fa
    expect(pickCharRow(FA, '发', { trad: '發', syllable: 'fa1' })?.key).toBe('發|发[fa1]')
    expect(pickCharRow(TAI, '台', { trad: '颱', syllable: 'tai2' })?.key).toBe('颱|台[tai2]') // 台风
  })

  it('never stops at a classical row that only stands in for another form', () => {
    expect(pickCharRow(TAI, '台', { trad: '台', syllable: 'tai2' })?.key).toBe('臺|台[tai2]') // 電台 writes 台
    expect(pickCharRow(TAI, '台', {})?.key).toBe('臺|台[tai2]')
  })

  it('takes the name row for a capitalized syllable only when asked (a common noun such as 汉语)', () => {
    expect(pickCharRow(HAN, '汉', { trad: '漢', syllable: 'Han4', exactCase: true })?.key).toBe('漢|汉[Han4]')
    expect(pickCharRow(HAN, '汉', { trad: '漢', syllable: 'Han4' })?.key).toBe('漢|汉[han4]')
  })
})

describe('mainFormKey', () => {
  it('finds the form a variant-only row points to, only within the same simplified form', () => {
    expect(mainFormKey(TAI[3])).toBe('臺|台[tai2]')
    expect(mainFormKey(TAI[0])).toBeNull()
    // a real sense besides the variant note: the row stands for itself
    expect(mainFormKey({ simp: '注', vi: ['tiêm; rót vào', 'biến thể của 註|注[zhu4]'], en: [] })).toBeNull()
  })
})
