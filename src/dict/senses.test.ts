import { describe, expect, it } from 'vitest'
import { entryHref, practiceHref, reportIssueUrl, searchHref } from './links'
import { firstMeaning, parseSense, plainSense } from './senses'

describe('parseSense', () => {
  it('separates notes in parentheses, hanzi runs and cross-references', () => {
    const s = parseSense('(trợ từ cuối câu) nhé; đi (vd. 我们走吧: chúng ta đi thôi)')
    expect(s.classifier).toBe(false)
    expect(s.spans.map((x) => x.note)).toEqual([true, false, true])
    expect(s.spans[2].parts).toEqual([
      { kind: 'text', text: '(vd. ' },
      { kind: 'zh', text: '我们走吧' },
      { kind: 'text', text: ': chúng ta đi thôi)' },
    ])
  })

  it('links trad|simp[pinyin] and simp[pinyin] references', () => {
    expect(parseSense('biến thể của 瞭|了[liao3]').spans[0].parts[1]).toEqual({
      kind: 'ref',
      key: '瞭|了[liao3]',
      hanzi: '了',
      trad: '瞭',
      pinyin: 'liǎo',
    })
    expect(parseSense('viết tắt của 的士[di1 shi4]').spans[0].parts[1]).toMatchObject({ key: '的士|的士[di1 shi4]', pinyin: 'dī shì' })
    expect(parseSense('cũng đọc là [di4]').spans[0].parts[1]).toEqual({ kind: 'pinyin', text: '[dì]' })
  })

  it('links nothing that cannot be an entry key: not one syllable per character', () => {
    // "以…的身份[yi3 xx5 de5 shen1 fen4]": the hanzi before the brackets are 的身份, five syllables
    const parts = parseSense('以…的身份[yi3 xx5 de5 shen1 fen4]').spans[0].parts
    expect(parts.some((p) => p.kind === 'ref')).toBe(false)
    expect(parts.at(-1)).toEqual({ kind: 'zh', text: '的身份' })
    expect(parseSense('作用[qi3 dao4 xx5 zuo4 yong4]').spans[0].parts).toEqual([{ kind: 'zh', text: '作用' }])
  })

  it('flags classifier senses in every spelling', () => {
    for (const s of ['Lượng từ: 个 (gè)', 'LT:個|个[ge4]', 'CL:個|个[ge4],位[wei4]']) expect(parseSense(s).classifier).toBe(true)
    const cl = parseSense('CL:個|个[ge4],位[wei4]')
    expect(cl.spans[0].parts.filter((p) => p.kind === 'ref').map((p) => (p.kind === 'ref' ? p.hanzi : ''))).toEqual(['个', '位'])
  })

  it('keeps an unclosed parenthesis as a note', () => {
    expect(parseSense('a (b').spans.map((x) => x.note)).toEqual([false, true])
  })
})

describe('plain text', () => {
  it('drops notes for list rows', () => {
    expect(plainSense('(hình thức kết hợp) yên lặng; bình yên')).toBe('yên lặng; bình yên')
    expect(plainSense('biến thể của 瞭|了[liao3]')).toBe('biến thể của 了')
    expect(firstMeaning(['Lượng từ: 个 (gè)', 'học sinh'])).toBe('học sinh')
    // a sense that is only a note stays readable
    expect(firstMeaning(['(trợ từ ngữ khí)'])).toBe('(trợ từ ngữ khí)')
  })

  it('keeps a short note right after a word, which says which sense is meant; never an example', () => {
    expect(plainSense('ăn (tết); đón (lễ); tổ chức (sinh nhật)')).toBe('ăn (tết); đón (lễ); tổ chức (sinh nhật)')
    expect(plainSense('(sau số đếm) giờ (vd. 三点: ba giờ)')).toBe('giờ')
    expect(plainSense('lớp (học); nhóm; tổ')).toBe('lớp (học); nhóm; tổ')
    // no stray space before ";" once a long note is gone
    expect(plainSense('nói (một điều gì đó cho ai biết, thường là tin tức) ; bảo')).toBe('nói; bảo')
  })
})

describe('links', () => {
  it('builds hash routes', () => {
    expect(entryHref('學生|学生[xue2 sheng5]')).toBe('#/tu/%E5%AD%B8%E7%94%9F%7C%E5%AD%A6%E7%94%9F%5Bxue2%20sheng5%5D')
    expect(decodeURIComponent(entryHref('學生|学生[xue2 sheng5]').slice(5))).toBe('學生|学生[xue2 sheng5]')
    expect(practiceHref('学')).toBe('#/luyen/5b66')
    expect(practiceHref('𠀀')).toBe('#/luyen/20000')
    expect(searchHref('hoc sinh')).toBe('#/tra-cuu?q=hoc%20sinh')
    expect(searchHref()).toBe('#/tra-cuu')
  })

  it('prefills an issue with the entry only', () => {
    const url = new URL(reportIssueUrl('學生|学生[xue2 sheng5]', 'v1'))
    expect(url.origin + url.pathname).toBe('https://github.com/0xki29/app/issues/new')
    expect(url.searchParams.get('title')).toBe('[Từ điển] 學生|学生[xue2 sheng5]')
    expect(url.searchParams.get('body')).toMatch(/Phiên bản dữ liệu: v1/)
  })
})
