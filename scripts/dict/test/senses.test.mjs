import { describe, expect, it } from 'vitest'
import { createKeyIndex } from '../lib/keys.mjs'
import { canonicalRefs, extractClassifiers, formatClassifier, normalizeSenses, templateXrefs, viPronunciationNote } from '../lib/senses.mjs'

const index = createKeyIndex(
  [
    ['什麼', '什么', 'shen2 me5'],
    ['了', '了', 'le5'],
    ['了', '了', 'liao3'],
    ['瞭', '了', 'liao3'],
    ['中國', '中国', 'Zhong1 guo2'],
  ].map(([trad, simp, py]) => ({ key: `${trad}|${simp}[${py}]`, trad, simp, py })),
)

describe('classifiers', () => {
  it('formats a reference as simplified form and tone marks', () => {
    expect(formatClassifier('個|个[ge4]')).toBe('个 (gè)')
    expect(formatClassifier('本[ben3]')).toBe('本 (běn)')
    expect(formatClassifier('位 (wèi)')).toBe('位 (wèi)')
  })

  it('finds every notation CVDICT and CC-CEDICT use', () => {
    expect(extractClassifiers('LT:個|个[ge4],位[wei4]')).toEqual({ rest: '', items: ['個|个[ge4]', '位[wei4]'] })
    expect(extractClassifiers('CL:件[jian4]')).toEqual({ rest: '', items: ['件[jian4]'] })
    expect(extractClassifiers('lượng từ: 件[jian4]')).toEqual({ rest: '', items: ['件[jian4]'] })
    expect(extractClassifiers('thế giới (LT:個|个[ge4])')).toEqual({ rest: 'thế giới', items: ['個|个[ge4]'] })
    expect(extractClassifiers('khủng long; LT:頭|头[tou2]')).toEqual({ rest: 'khủng long', items: ['頭|头[tou2]'] })
    expect(extractClassifiers('Lượng từ: 位 (wèi)')).toEqual({ rest: '', items: ['位 (wèi)'] })
    expect(extractClassifiers('(lượng từ) quyển; cuốn')).toEqual({ rest: '(lượng từ) quyển; cuốn', items: [] })
  })

  it('gathers them into one last sense', () => {
    expect(normalizeSenses(['LT:個|个[ge4]', 'thế giới (LT:個|个[ge4])', 'vũ trụ; LT:位[wei4]'], { vietnamese: true })).toEqual([
      'thế giới',
      'vũ trụ',
      'Lượng từ: 个 (gè), 位 (wèi)',
    ])
  })
})

describe('cross-references', () => {
  it('resolves to the current key, in CC-CEDICT notation', () => {
    const counts = { resolved: 0, unresolved: 0 }
    expect(canonicalRefs('xem 什麼|什么[shen2 me5]', index, counts)).toBe('xem 什麼|什么[shen2 me5]')
    expect(canonicalRefs('biến thể của 了[liao3]', index, counts)).toBe('biến thể của 了[liao3]')
    expect(canonicalRefs('see 中国[zhong1 guo2]', index, counts)).toBe('see 中國|中国[Zhong1 guo2]')
    expect(counts).toEqual({ resolved: 3, unresolved: 0 })
  })

  it('turns what it cannot pin to one entry into plain text, and never touches non-Han brackets', () => {
    const counts = { resolved: 0, unresolved: 0 }
    const seen = []
    expect(canonicalRefs('see 不在[bu4 zai4]', index, counts, seen)).toBe('see 不在 (bù zài)')
    // not one syllable per character (a placeholder in the pinyin): the hanzi alone
    expect(canonicalRefs('以…的身份[yi3 xx5 de5 shen1 fen4]', index, counts)).toBe('以…的身份')
    expect(canonicalRefs('Taiwan pr. [bu4 fen4]', index, counts)).toBe('Taiwan pr. [bu4 fen4]')
    expect(counts).toEqual({ resolved: 0, unresolved: 2 })
    expect(seen).toEqual(['不在[bu4 zai4]'])
  })

  it('reads pinyin written without spaces and forms written the wrong way round', () => {
    const counts = { resolved: 0, unresolved: 0 }
    expect(canonicalRefs('xem 什么[shen2me5]', index, counts)).toBe('xem 什麼|什么[shen2 me5]')
    expect(canonicalRefs('xem 什么|什麼[shen2 me5]', index, counts)).toBe('xem 什麼|什么[shen2 me5]')
    expect(counts).toEqual({ resolved: 2, unresolved: 0 })
  })
})

describe('normalizeSenses', () => {
  it('applies NFC, spacing and hoà-style tone marks to Vietnamese only', () => {
    expect(normalizeSenses(['  hòa   bình ', 'thủy', 'hòa bình'], { vietnamese: true })).toEqual(['hoà bình', 'thuỷ'])
    expect(normalizeSenses(['  peace  ', ''])).toEqual(['peace'])
  })
})

describe('viPronunciationNote', () => {
  it('reads CVDICT’s "phiên âm Đài Loan [..]" (Taiwan pr.) as a pronunciation, and leaves a transliteration note alone', () => {
    expect(viPronunciationNote('phiên âm Đài Loan [fa3]')).toBe('cách đọc ở Đài Loan [fa3]')
    expect(viPronunciationNote('tóc/phiên âm Đài Loan: [xi2]')).toBe('tóc/cách đọc ở Đài Loan [xi2]')
    expect(viPronunciationNote('thủ đô của Slovakia (phiên âm Đài Loan)')).toBe('thủ đô của Slovakia (phiên âm Đài Loan)')
    expect(normalizeSenses(['tóc', 'phiên âm Đài Loan [fa3]'], { vietnamese: true })).toEqual(['tóc', 'cách đọc ở Đài Loan [fa3]'])
  })
})

describe('templateXrefs', () => {
  it('translates entries made only of cross-references', () => {
    expect(templateXrefs(['used in 南無|南无[na1 mo2]', 'Taiwan pr. [na2]'])).toEqual(['dùng trong 南無|南无[na1 mo2]', 'cách đọc ở Đài Loan [na2]'])
    expect(templateXrefs(['old variant of 們|们[men5]'])).toEqual(['biến thể cũ của 們|们[men5]'])
    expect(templateXrefs(['erhua variant of 點|点[dian3]'])).toEqual(['biến thể nhi hoá của 點|点[dian3]'])
    expect(templateXrefs(['see also 什麼|什么[shen2 me5]'])).toEqual(['xem thêm 什麼|什么[shen2 me5]'])
  })

  it('returns null as soon as one sense is real content', () => {
    expect(templateXrefs(['see X', 'a real sense'])).toBeNull()
    expect(templateXrefs([])).toBeNull()
  })
})
