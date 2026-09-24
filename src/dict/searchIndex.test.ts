import { describe, expect, it } from 'vitest'
import { buildIndex, cleanQuery, DictIndex, IndexBuilder, runSync, senseGlossParts, senseGlosses } from './searchIndex'
import { FIXTURE_TEXTS } from './testHarness'
import type { MatchKind } from './types'

// A ~400-row slice of the real data (src/dict/__fixtures__, see its README), in rank order.
const texts = FIXTURE_TEXTS
const index = buildIndex(texts)

/** "simp pinyin" of the top hits. */
function top(q: string, n = 1): string[] {
  return index
    .search(q)
    .hits.slice(0, n)
    .map((h) => `${index.entry(h.id).simp} ${index.entry(h.id).pinyin}`)
}

function group(q: string, kind: MatchKind): string[] | undefined {
  return index
    .search(q)
    .groups?.find((g) => g.kind === kind)
    ?.hits.map((h) => index.entry(h.id).simp)
}

describe('golden queries', () => {
  it.each([
    ['学生', '学生 xue2 sheng5'],
    ['學生', '学生 xue2 sheng5'],
    ['xuesheng', '学生 xue2 sheng5'],
    ['xue sheng', '学生 xue2 sheng5'],
    ['xue2sheng1', '学生 xue2 sheng5'], // typed 1, the dictionary's neutral tone takes it
    ['xuéshēng', '学生 xue2 sheng5'],
    ['xues', '学生 xue2 sheng5'],
    ['hoc sinh', '学生 xue2 sheng5'],
    ['học sinh', '学生 xue2 sheng5'],
    ['HỌC SINH', '学生 xue2 sheng5'],
    ['cam on', '谢谢 xie4 xie5'],
    ['cảm ơn', '谢谢 xie4 xie5'],
    ['xiexie', '谢谢 xie4 xie5'],
    ['你好', '你好 ni3 hao3'],
    ['nihao', '你好 ni3 hao3'],
    ['ni3hao3', '你好 ni3 hao3'],
    ['xin chao', '你好 ni3 hao3'],
    ['学习', '学习 xue2 xi2'],
    ['學習', '学习 xue2 xi2'],
    ['zhongguo', '中国 Zhong1 guo2'],
    ['trung quoc', '中国 Zhong1 guo2'],
    ['ngan hang', '银行 yin2 hang2'],
    ["xi'an", '西安 Xi1 an1'],
    ['ăn', '吃 chi1'],
    ['一个', '一个 yi1 ge5'],
    ['yige', '一个 yi1 ge5'],
  ])('%s → %s', (q, want) => {
    expect(top(q)).toEqual([want])
  })

  it('reads ü typed as ü, v, u: (and u, lower)', () => {
    for (const q of ['lv4', 'lü4', 'lu:4', 'lǜ']) {
      expect(top(q, 3).every((s) => s.endsWith('lu:4'))).toBe(true)
      expect(top(q, 3)).toContain('绿 lu:4')
    }
    expect(index.search('lu').hits.map((h) => index.entry(h.id).simp)).toContain('绿')
  })

  it('lists every reading of a character first, most common first', () => {
    expect(top('行', 3)).toEqual(['行 xing2', '行 hang2', '行 heng2'])
    expect(top('长', 2)).toEqual(['长 zhang3', '长 chang2'])
    expect(top('了', 2)).toEqual(['了 le5', '了 liao3'])
    // then words starting with it, then words containing it
    const r = index.search('行').hits.map((h) => index.entry(h.id).simp)
    expect(r.indexOf('行为')).toBeLessThan(r.indexOf('银行'))
    expect(r).toContain('自行车')
  })

  it('finds a word by Hán Việt alternates and the other reading of a character', () => {
    expect(top('ngan hang')).toEqual(['银行 yin2 hang2'])
    expect(index.search('hang').hits.map((h) => index.entry(h.id).pinyin)).toContain('hang2')
  })
})

describe('grouping of short Latin queries', () => {
  it('"an" is pinyin (ān, àn), Hán Việt (an, án) and meaning (ăn)', () => {
    const r = index.search('an')
    expect(r.groups?.map((g) => g.kind).sort()).toEqual(['hanviet', 'meaning', 'pinyin'])
    expect(group('an', 'pinyin')).toEqual(expect.arrayContaining(['安', '按', '案']))
    expect(group('an', 'hanviet')).toEqual(expect.arrayContaining(['安', '按', '案']))
    expect(group('an', 'meaning')?.[0]).toBe('吃')
  })

  it('typed Vietnamese marks put the meaning first and leave pinyin out', () => {
    const r = index.search('ăn')
    expect(r.groups?.[0].kind).toBe('meaning')
    expect(r.groups?.some((g) => g.kind === 'pinyin')).toBe(false)
  })

  it('"hành" ranks the exact reading first, then words, then other tones', () => {
    const hv = group('hành', 'hanviet')!
    expect(hv[0]).toBe('行')
    expect(hv.indexOf('行为')).toBeGreaterThan(0)
    expect(group('hành', 'meaning')).toContain('葱') // hành lá
  })

  it('"nhi" finds 儿 and 而 by Hán Việt', () => {
    expect(group('nhi', 'hanviet')).toEqual(expect.arrayContaining(['儿', '而']))
  })

  it('does not group phrases or single-kind queries', () => {
    expect(index.search('hoc sinh').groups).toBeNull()
    expect(index.search('xuesheng').groups).toBeNull()
    expect(index.search('学').groups).toBeNull()
  })
})

describe('meanings', () => {
  it('ranks English fallback text below Vietnamese, in its own index', () => {
    // 一个 has no Vietnamese; its English "a; an; one" must not outrank 吃 "ăn" or the pinyin an.
    const r = index.search('an')
    const yige = r.hits.findIndex((h) => index.entry(h.id).simp === '一个')
    const chi = r.hits.findIndex((h) => index.entry(h.id).simp === '吃')
    expect(chi).toBeGreaterThanOrEqual(0)
    if (yige >= 0) {
      expect(yige).toBeGreaterThan(chi)
      expect(r.hits[yige].lang).toBe('en')
    }
    expect(r.hits.filter((h) => h.lang === 'en').every((h) => h.score < 700)).toBe(true)
  })

  it('finds rows without Vietnamese by their English, below any Vietnamese match', () => {
    const r = index.search('tobacco')
    const yan = r.hits.find((h) => index.entry(h.id).simp === '烟' && index.entry(h.id).flags.includes('en'))
    expect(yan).toMatchObject({ kind: 'meaning', lang: 'en' })
    expect(yan!.score).toBeLessThan(850 + 20) // a Vietnamese exact gloss scores at least 870 before popularity
    // English is matched on whole words only: no prefix expansion
    expect(index.search('tobac').hits.some((h) => h.lang === 'en')).toBe(false)
  })

  it('reports which sense matched', () => {
    const hit = index.search('hành lá').hits.find((h) => index.entry(h.id).simp === '葱')
    expect(hit?.kind).toBe('meaning')
    expect(index.entry(hit!.id).vi[hit!.sense]).toMatch(/hành lá/)
  })

  it('does not match words inside examples as the gloss itself', () => {
    // 是: "là (…, vd. 我是学生: tôi là học sinh; …)" — the example is not a gloss "học sinh".
    const shi = index.search('học sinh').hits.find((h) => index.entry(h.id).simp === '是')
    expect(shi === undefined || shi.score < 700).toBe(true)
  })

  it('splits glosses on ; outside parentheses only', () => {
    expect(senseGlosses('a; b (c; d) e; [pin1] f')).toEqual(['a', ' b   e', '  f'])
  })

  it('marks a gloss a note narrows, but not one an example follows', () => {
    expect(senseGlossParts('uống (thuốc); ăn').map((g) => g.narrowed)).toEqual([true, false])
    expect(senseGlossParts('(khẩu ngữ) ngửi').map((g) => g.narrowed)).toEqual([false])
    // A label before the sense narrows every gloss of it, unless it is plain register.
    expect(senseGlossParts('(miệt thị) Hàn Quốc').map((g) => g.narrowed)).toEqual([true])
    expect(senseGlossParts('(sau số đếm) giờ; tiếng').map((g) => g.narrowed)).toEqual([true, true])
    expect(senseGlossParts('đi (vd. 我们走吧: chúng ta đi thôi)').map((g) => g.narrowed)).toEqual([false])
  })

  it('ranks a sense a note narrows, a pattern gloss and a later sense below the word itself', () => {
    const row = (simp: string, py: string, vi: string, pop: number) => [simp, '', py, '', '', vi, '', '', String(pop), 'mt'].join('\t')
    const small = buildIndex([
      [row('吃', 'chi1', 'ăn/uống (thuốc)', 97), row('喝', 'he1', 'uống', 90), row('的', 'de5', 'của/cái …; người …', 99), row('人', 'ren2', 'người', 90), row('先生', 'xian1 sheng5', 'ông/thầy/bác sĩ', 95), row('医生', 'yi1 sheng1', 'bác sĩ', 71)].join('\n'),
    ])
    const first = (q: string) => small.entry(small.search(q).hits[0].id).simp
    expect(first('uống')).toBe('喝')
    expect(first('người')).toBe('人')
    expect(first('bác sĩ')).toBe('医生')
  })
})

describe('query cleaning', () => {
  it('drops punctuation, symbols and emoji, folds full-width Latin, keeps what pinyin uses', () => {
    expect(cleanQuery('学生。')).toBe('学生')
    expect(cleanQuery('“你好！”😀')).toBe('你好')
    expect(cleanQuery('ｘｕｅｓｈｅｎｇ')).toBe('xuesheng')
    expect(cleanQuery("xi'an")).toBe("xi'an")
    expect(cleanQuery('lu:4')).toBe('lu:4')
  })

  it('searches the hanzi of a query mixed with Latin, or its first word', () => {
    expect(top('学sheng')[0]).toMatch(/^学 /)
    expect(top('学生 老师')).toEqual(['学生 xue2 sheng5'])
    expect(top('学生。')).toEqual(['学生 xue2 sheng5'])
  })
})

describe('lookups', () => {
  it('finds an entry by key, leniently', () => {
    const id = index.findKey('學生|学生[xue2 sheng5]')
    expect(index.entry(id).simp).toBe('学生')
    expect(index.findKey('學生|学生[Xue2 sheng5]')).toBe(id) // capitalization changed upstream
    expect(index.entry(index.findKey('瞭|了[liao3]')).trad).toBe('瞭')
    expect(index.findKey('不存在|不存在[bu4 cun2 zai4]')).toBe(-1)
    expect(index.findKey('garbage')).toBe(-1)
  })

  it('lists the single-character rows of a simplified or traditional form', () => {
    const simp = index.charRows('学').map((id) => index.entry(id).key)
    expect(simp).toContain('學|学[xue2]')
    expect(index.charRows('學')).toEqual(index.charRows('学').filter((id) => index.entry(id).trad === '學'))
  })
})

describe('building', () => {
  it('builds shard by shard, core first, with the same result', () => {
    const b = new IndexBuilder()
    runSync(b.addShard(texts[0], 0))
    const core = runSync(b.finish())
    expect(core.findKey('學生|学生[xue2 sheng5]')).toBeGreaterThanOrEqual(0)
    runSync(b.addShard(texts[1], core.size))
    const full = runSync(b.finish())
    expect(full.size).toBe(index.size)
    expect(full.search('an')).toEqual(index.search('an'))
    // the core index is not changed by adding more
    expect(core.size).toBeLessThan(full.size)
    expect(core.search('an').hits.every((h) => h.id < core.size)).toBe(true)
  })

  it('sorts keys (sliced merge sort) with equal keys in row order', () => {
    for (const k of [index.simpK, index.tradK, index.pyK, index.hvK]) {
      for (let i = 1; i < k.keys.length; i++) {
        expect(k.keys[i - 1] <= k.keys[i]).toBe(true)
        if (k.keys[i - 1] === k.keys[i]) expect(k.ids[i - 1]).toBeLessThan(k.ids[i])
      }
    }
    const tokens = index.viP.tokens
    expect([...tokens].sort()).toEqual(tokens)
  })

  it('rejects a shard out of order', () => {
    const b = new IndexBuilder()
    expect(() => runSync(b.addShard(texts[1], 5))).toThrow()
  })

  it('round-trips through a snapshot', () => {
    const copy = DictIndex.fromParts(structuredClone(index.toParts()))
    for (const q of ['an', '学生', 'hoc sinh', 'xue2sheng1', 'cảm ơn', '行']) expect(copy.search(q)).toEqual(index.search(q))
    expect(copy.entry(10)).toEqual(index.entry(10))
  })

  it('accepts shards with or without a final newline', () => {
    const noFinal = buildIndex([texts[0].replace(/\n$/, '')])
    expect(noFinal.size).toBe(buildIndex([texts[0]]).size)
  })
})
