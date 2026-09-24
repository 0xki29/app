import { describe, expect, it } from 'vitest'
import { compareRows, entryFlags, FLAGS, isXrefOnly, popularity, rankScore } from '../lib/flags.mjs'

const base = { py: 'xue2 sheng5', defs: ['student'], viSource: 'cvdict', enShown: false, hvLow: false, noStroke: false }

describe('entryFlags', () => {
  it('marks where the Vietnamese came from', () => {
    expect(entryFlags(base)).toEqual(['mt'])
    expect(entryFlags({ ...base, viSource: 'curated-ai' })).toEqual(['cur-ai'])
    expect(entryFlags({ ...base, viSource: 'curated' })).toEqual(['cur'])
    expect(entryFlags({ ...base, viSource: 'template' })).toEqual([])
    expect(entryFlags({ ...base, viSource: null, enShown: true })).toEqual(['en'])
  })

  it('marks proper nouns by CC-CEDICT’s capitalized pinyin', () => {
    expect(entryFlags({ ...base, py: 'Bei3 jing1' })).toContain('pn')
    expect(entryFlags({ ...base, py: 'san1 C' })).not.toContain('pn')
  })

  it('marks cross-reference-only entries, pronunciation notes aside', () => {
    expect(entryFlags({ ...base, defs: ['variant of 們|们[men5]'] })).toContain('var')
    expect(entryFlags({ ...base, defs: ['used in 南無|南无[na1 mo2]', 'Taiwan pr. [na2]'] })).toContain('usedin')
    expect(entryFlags({ ...base, defs: ['see 什麼|什么[shen2 me5]'] })).toEqual(['usedin', 'mt'])
    expect(entryFlags({ ...base, defs: ['old variant of X', 'see Y'] })).toEqual(['var', 'usedin', 'mt'])
    expect(entryFlags({ ...base, defs: ['variant of X', 'a real sense'] })).toEqual(['mt'])
  })

  it('lists flags in one fixed order', () => {
    const all = entryFlags({ py: 'Ta1', defs: ['variant of X'], viSource: 'cvdict', enShown: true, hvLow: true, noStroke: true })
    expect(all).toEqual(FLAGS.filter((f) => all.includes(f)))
    expect(all).toEqual(['pn', 'var', 'mt', 'en', 'hvlow', 'nostroke'])
  })

  it('says where a low-confidence or curated Hán Việt reading comes from', () => {
    expect(entryFlags({ ...base, hvLow: true, hvNom: true })).toEqual(['mt', 'hvlow', 'hvnom'])
    expect(entryFlags({ ...base, hvLow: true })).toEqual(['mt', 'hvlow'])
    expect(entryFlags({ ...base, hvCurated: 'ai-draft' })).toEqual(['mt', 'hvcur-ai'])
    expect(entryFlags({ ...base, hvCurated: 'reviewed' })).toEqual(['mt', 'hvcur'])
  })

  it('drops the proper-noun flag of a curated common noun (汉语, 星期天)', () => {
    expect(entryFlags({ ...base, py: 'Han4 yu3', notProperNoun: true })).not.toContain('pn')
  })

  it('marks an entry CC-CEDICT lacks, written by curation (extra-entries.tsv)', () => {
    expect(entryFlags({ ...base, viSource: 'curated-ai', added: true })).toEqual(['cur-ai', 'added'])
  })

  it('isXrefOnly needs at least one reference', () => {
    expect(isXrefOnly([])).toBe(false)
    expect(isXrefOnly(['Taiwan pr. [na2]'])).toBe(false)
  })
})

describe('rank', () => {
  it('sinks variants and cross-references, and proper nouns lose ties', () => {
    const z = 5
    expect(rankScore({ zipf: z, defs: ['a word'], py: 'hao3' })).toBe(5)
    expect(rankScore({ zipf: z, defs: ['variant of X'], py: 'hao3' })).toBe(2)
    expect(rankScore({ zipf: z, defs: ['see X'], py: 'hao3' })).toBe(4.5)
    expect(rankScore({ zipf: z, defs: ['a name'], py: 'Hao3' })).toBeCloseTo(4.95)
  })

  it('shares a character’s frequency among its readings by kHanyuPinlu', () => {
    const pinlu = new Map([
      ['le5', 900],
      ['liao3', 100],
    ])
    const le = rankScore({ zipf: 7, defs: ['particle'], py: 'le5', single: true, pinlu })
    const liao = rankScore({ zipf: 7, defs: ['to finish'], py: 'liao3', single: true, pinlu })
    const liao4 = rankScore({ zipf: 7, defs: ['clear'], py: 'liao4', single: true, pinlu })
    expect(le).toBe(7) // the most frequent reading keeps the full Zipf
    expect(liao).toBeCloseTo(7 - 1) // log10 of its share (100 of 1000)
    expect(liao4).toBeCloseTo(7 - 1.5) // not listed at all
    // 的 dì: 52 of 75,805 — below any HSK 1 word, capped at −4
    const di = rankScore({ zipf: 7.8, defs: ['target'], py: 'di4', single: true, pinlu: new Map([['de5', 75596], ['di2', 157], ['di4', 52]]) })
    expect(di).toBeCloseTo(7.8 - 3.16, 1)
    // a single listed reading is the only one: another reading of it is not listed (约 yāo)
    expect(rankScore({ zipf: 5, defs: ['weigh'], py: 'yao1', single: true, pinlu: new Map([['yue1', 553]]) })).toBeCloseTo(3.5)
  })

  it('sinks a secondary row: a one-character name beside the common word, or a variant of the same form', () => {
    expect(rankScore({ zipf: 6.8, defs: ['surname He'], py: 'He2', secondary: true })).toBeCloseTo(6.8 - 0.05 - 1.5)
    expect(rankScore({ zipf: 6.8, defs: ['a name'], py: 'He2', properNoun: false })).toBe(6.8)
  })

  it('maps score and HSK level to a 0–100 popularity', () => {
    expect(popularity(7.79, 1)).toBe(98)
    expect(popularity(4, null)).toBe(40)
    expect(popularity(-2, null)).toBe(0)
    expect(popularity(9.5, 1)).toBe(100)
  })

  it('puts HSK words first by level, then by score, then shorter, then code order', () => {
    const rows = [
      { simp: '乙', py: 'b', trad: '乙', hsk: null, score: 9 },
      { simp: '甲', py: 'a', trad: '甲', hsk: 2, score: 1 },
      { simp: '丙', py: 'c', trad: '丙', hsk: 1, score: 1 },
      { simp: '丁丁', py: 'd', trad: '丁丁', hsk: null, score: 9 },
      { simp: '丁', py: 'd', trad: '丁', hsk: null, score: 9 },
    ]
    expect(rows.sort(compareRows).map((r) => r.simp)).toEqual(['丙', '甲', '丁', '乙', '丁丁'])
  })
})
