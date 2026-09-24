import { describe, expect, it } from 'vitest'
import { byFrequency, matchHskWord, parseCsv, readHskChars, readHskWords, refineHskKeys } from '../lib/hsk.mjs'
import { variantTargets } from '../lib/join.mjs'
import { createKeyIndex } from '../lib/keys.mjs'

const WORDS = [
  'ID,Simplified,Traditional,Pinyin,POS,Level,WebNo,WebPinyin,OCR,Variants,CEDICT',
  'L1-0001,爱,愛,ài,V,1,18,ài,爱,,愛|爱[ai4]',
  'L1-0004,爸爸|爸,爸爸|爸,bàba|bà,N,1,83,bàba|bà,爸爸｜爸,"[{""Simplified"": ""爸爸"", ""Pinyin"": ""bàba"", ""Traditional"": ""爸爸"", ""CEDICT"": ""爸爸|爸爸[ba4 ba5]""}, {""Simplified"": ""爸"", ""Pinyin"": ""bà"", ""Traditional"": ""爸"", ""CEDICT"": ""爸|爸[ba4]""}]",爸爸|爸爸[ba4 ba5]',
  'L1-0338,是不是,是不是,shì bu shì,,1,7333,shì bu shì,是不是,,是不是|是不是[shi4 bu4 shi4]',
  'L1-0044,车上,車上,chē shang,,1,906,chē shang,车上,,',
  'L7-3893,说起来,說起來,shuō qǐlái,,7-9,7600,shuō ·qǐ·lái,说起来,,',
].join('\r\n')

const entries = [
  ['愛', '爱', 'ai4'],
  ['爸爸', '爸爸', 'ba4 ba5'],
  ['爸', '爸', 'ba4'],
  ['是不是', '是不是', 'shi4 bu5 shi4'],
  ['車上', '车上', 'che1 shang5'],
  ['說起來', '说起来', 'shuo1 qi3 lai5'],
  ['中醫', '中医', 'zhong1 yi1'],
  ['和', '和', 'he2'],
  ['和', '和', 'He2'],
].map(([trad, simp, py]) => ({ key: `${trad}|${simp}[${py}]`, trad, simp, py }))
const index = createKeyIndex(entries)

describe('CSV', () => {
  it('handles quotes, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b,""c""",d\r\n1,2,3\r\n')).toEqual([
      ['a', 'b,"c"', 'd'],
      ['1', '2', '3'],
    ])
  })
})

describe('HSK lists', () => {
  const words = readHskWords(WORDS)

  it('reads levels (7–9 as 7), keys and written forms', () => {
    expect(words.map((w) => [w.simp, w.level])).toEqual([
      ['爱', 1],
      ['爸爸|爸', 1],
      ['是不是', 1],
      ['车上', 1],
      ['说起来', 7],
    ])
    expect(words[1].forms.map((f) => f.keys)).toEqual([['爸爸|爸爸[ba4 ba5]'], ['爸|爸[ba4]']])
  })

  it('matches each word to current entries, by key or by reading', () => {
    const match = (w) => matchHskWord(w, (k) => index.resolve(k), (s) => index.bySimp(s))
    expect(match(words[0])).toEqual(['愛|爱[ai4]'])
    expect(match(words[1])).toEqual(['爸爸|爸爸[ba4 ba5]', '爸|爸[ba4]'])
    expect(match(words[2])).toEqual(['是不是|是不是[shi4 bu5 shi4]']) // key from an older CC-CEDICT
    expect(match(words[3])).toEqual(['車上|车上[che1 shang5]']) // no key: same reading
    expect(match(words[4])).toEqual(['說起來|说起来[shuo1 qi3 lai5]']) // citation tones differ
  })

  it('reads the character list and its writing levels', () => {
    const chars = readHskChars('Hanzi,Level,WritingLevel,Traditional,Freq,Examples\n爱,1,1,愛,20,爱\n乙,3,,乙,1,乙\n')
    expect(chars).toEqual([
      { char: '爱', level: 1, writingLevel: 1, words: 20 },
      { char: '乙', level: 3, writingLevel: null, words: 1 },
    ])
  })

  it('orders a writing list by text frequency, the list order breaking ties', () => {
    const freq = { 我: 9, 爸: 2, 爱: 5, 八: 5 }
    expect(byFrequency(['爱', '八', '爸', '我'], (c) => freq[c])).toEqual(['我', '爱', '八', '爸'])
  })

  it('tags the main form, not an archaic variant row, and the common word, not a same-form name', () => {
    const ents = [
      ['台', '台', 'tai2', ['(classical) you (in letters)', 'variant of 臺|台[tai2]']],
      ['臺', '台', 'tai2', ['platform; stage']],
      ['注', '注', 'zhu4', ['to pour into', 'variant of 註|注[zhu4]']],
      ['註', '注', 'zhu4', ['to annotate']],
      ['標致', '标致', 'Biao1 zhi4', ['Peugeot (French car brand)']],
      ['標致', '标致', 'biao1 zhi5', ['beautiful (of a woman)']],
    ].map(([trad, simp, py, defs]) => ({ key: `${trad}|${simp}[${py}]`, trad, simp, py, defs }))
    const idx = createKeyIndex(ents)
    const deps = { entryOf: (k) => ents.find((e) => e.key === k), bySimp: (x) => idx.bySimp(x), resolveKey: (k) => idx.resolve(k), variantTargetsOf: variantTargets }
    const word = (simp, pinyin) => ({ simp, forms: [{ simp, pinyin, keys: [] }] })
    expect(refineHskKeys(word('台', 'tái'), ['台|台[tai2]', '臺|台[tai2]'], deps)).toEqual({ keys: ['臺|台[tai2]'], dropped: ['台|台[tai2] → 臺|台[tai2]'], swapped: [] })
    // a real sense besides the variant note: both keep the tag
    expect(refineHskKeys(word('注', 'zhù'), ['注|注[zhu4]', '註|注[zhu4]'], deps).keys).toEqual(['注|注[zhu4]', '註|注[zhu4]'])
    expect(refineHskKeys(word('标致', 'biāozhì'), ['標致|标致[Biao1 zhi4]'], deps).keys).toEqual(['標致|标致[biao1 zhi5]'])
    // the list itself writes a name: it stays
    expect(refineHskKeys(word('标致', 'Biāozhì'), ['標致|标致[Biao1 zhi4]'], deps).keys).toEqual(['標致|标致[Biao1 zhi4]'])
  })
})

describe('key resolution', () => {
  it('keeps existing keys and resolves drifted ones only when unambiguous', () => {
    expect(index.resolve('愛|爱[ai4]')).toBe('愛|爱[ai4]')
    expect(index.resolve('中醫|中医[Zhong1 yi1]')).toBe('中醫|中医[zhong1 yi1]')
    expect(index.resolve('是不是|是不是[shi4 bu4 shi4]')).toBe('是不是|是不是[shi4 bu5 shi4]')
    expect(index.resolve('和|和[HE2]')).toBeNull() // he2 and He2 both fit
    expect(index.resolve('不|不[bu4]')).toBeNull()
    expect(index.resolve('not a key')).toBeNull()
  })
})
