import { describe, expect, it } from 'vitest'
import { dedupeEntries, parseCedict } from '../lib/cedict.mjs'
import { isVariantOnly, joinVietnamese, variantTargets } from '../lib/join.mjs'

const ce = (text) => dedupeEntries(parseCedict(text).entries)[0]
const cv = (text) => parseCedict(text).entries

describe('joinVietnamese: the five passes', () => {
  const cedict = ce(
    [
      '學生 学生 [xue2 sheng5] /student/',
      '北京 北京 [Bei3 jing1] /Beijing/',
      '部分 部分 [bu4 fen5] /part/',
      '乾燥 干燥 [gan1 zao4] /dry/',
      '和 和 [he2] /and/',
      '和 和 [He2] /surname He/',
      '電視台 电视台 [dian4 shi4 tai2] /television station/',
      '電視臺 电视台 [dian4 shi4 tai2] /variant of 電視台|电视台[dian4 shi4 tai2]/',
      '裏 里 [li3] /variant of 裡|里[li3]/',
      '裡 里 [li3] /inside/',
    ].join('\n'),
  )
  const cvdict = cv(
    [
      '學生 学生 [xue2 sheng5] /học sinh/',
      '北京 北京 [bei3 jing1] /Bắc Kinh/', // capitalization changed since
      '部分 部分 [bu4 fen4] /bộ phận/', // tone changed since
      '亁燥 干燥 [gan1 zao4] /khô/', // traditional form re-chosen since
      '和 和 [he2] /và/',
      '電視臺 电视台 [dian4 shi4 tai2] /đài truyền hình/', // was the main form then
      '裏 里 [li3] /biến thể của 裡|里[li3]/',
    ].join('\n'),
  )
  const { vi, stats } = joinVietnamese(cedict, cvdict)

  it('matches exact keys first', () => {
    expect(vi.get('學生|学生[xue2 sheng5]')).toMatchObject({ defs: ['học sinh'], pass: 1 })
  })

  it('then pinyin ignoring case, then ignoring tones, then by simplified form', () => {
    expect(vi.get('北京|北京[Bei3 jing1]')).toMatchObject({ defs: ['Bắc Kinh'], pass: 2 })
    expect(vi.get('部分|部分[bu4 fen5]')).toMatchObject({ defs: ['bộ phận'], pass: 3 })
    expect(vi.get('乾燥|干燥[gan1 zao4]')).toMatchObject({ defs: ['khô'], pass: 4 })
  })

  it('never lends an entry that still has its exact match to a neighbour', () => {
    expect(vi.get('和|和[he2]')).toMatchObject({ defs: ['và'], pass: 1 })
    expect(vi.has('和|和[He2]')).toBe(false)
  })

  it('lends a variant entry’s full translation to the main form it now points to', () => {
    expect(vi.get('電視台|电视台[dian4 shi4 tai2]')).toMatchObject({ defs: ['đài truyền hình'], pass: 5 })
    // …but not a translation that is itself only a variant note (裏's "biến thể của 裡").
    expect(vi.get('裏|里[li3]')).toMatchObject({ pass: 1 })
    expect(vi.has('裡|里[li3]')).toBe(false)
  })

  it('counts every pass', () => {
    expect(stats).toMatchObject({
      joinedExact: 4,
      joinedCaseInsensitive: 1,
      joinedToneless: 1,
      joinedSimplifiedToneless: 1,
      borrowedFromVariant: 1,
      cedictRowsWithoutVietnamese: 2,
    })
  })

  it('accepts ambiguity nowhere: two leftovers that fit the same entry match neither', () => {
    const r = joinVietnamese(ce('好 好 [hao3] /good/'), cv('好 好 [hao1] /a/\n好 好 [hao2] /b/'))
    expect(r.vi.size).toBe(0)
  })

  it('does not join pure variant entries by simplified form', () => {
    const r = joinVietnamese(ce('乾 干 [gan1] /variant of 干[gan1]/'), cv('幹 干 [gan1] /làm/'))
    expect(r.vi.size).toBe(0)
  })

  it('is one-to-one: a leftover two entries would take goes to neither', () => {
    const r = joinVietnamese(ce('中土 中土 [Zhong1 tu3] /China/\n中土 中土 [Zhong1 Tu3] /China-Turkey/'), cv('中土 中土 [zhong1 tu3] /Trung Quốc-Thổ Nhĩ Kỳ/'))
    expect(r.vi.size).toBe(0)
    expect(r.stats.looseJoinsSkippedAsShared).toHaveLength(2)
  })

  it('skips a denied loose join and lists every proper-noun case crossing', () => {
    const cedict = ce('科克 科克 [Ke1 ke4] /Cork, city in Ireland/\n教皇 教皇 [jiao4 huang2] /pope/')
    const cvdict = cv('科克 科克 [ke1 ke4] /nút chai/\n教皇 教皇 [Jiao4 huang2] /Giáo hoàng/')
    const r = joinVietnamese(cedict, cvdict, { deny: new Set(['科克|科克[Ke1 ke4]']) })
    expect(r.vi.has('科克|科克[Ke1 ke4]')).toBe(false)
    expect(r.vi.get('教皇|教皇[jiao4 huang2]')).toMatchObject({ defs: ['Giáo hoàng'], pass: 2 })
    expect(r.stats.looseJoinsDenied).toEqual(['科克|科克[Ke1 ke4] ← 科克|科克[ke1 ke4]'])
    expect(r.stats.looseJoinsAcrossProperNounCase).toEqual(['教皇|教皇[jiao4 huang2] ← 教皇|教皇[Jiao4 huang2]'])
  })
})

describe('variant helpers', () => {
  it('reads "variant of" targets as keys', () => {
    expect(variantTargets(['old variant of 們|们[men5]', 'variant of 了[le5]'])).toEqual(['們|们[men5]', '了|了[le5]'])
    expect(isVariantOnly(['old variant of 們|们[men5]'])).toBe(true)
    expect(isVariantOnly(['variant of X', 'a real sense'])).toBe(false)
    expect(isVariantOnly([])).toBe(false)
  })
})
