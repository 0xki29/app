import { describe, expect, it } from 'vitest'
import { dedupeEntries, entryKey, parseCedict, parseKey } from '../lib/cedict.mjs'

describe('parseCedict', () => {
  it('reads the header, entries and senses; CRLF and BOM are fine', () => {
    const text = [
      '\uFEFF# CC-CEDICT',
      '#! entries=3',
      '#! date=2026-09-23T05:36:01Z',
      '學生 学生 [xue2 sheng5] /student/schoolchild/',
      '中國 中国 [Zhong1 guo2] /China/',
      '% % [pa1] /percent (Tw)/',
      '',
    ].join('\r\n')
    const r = parseCedict(text)
    expect(r.header).toEqual({ entries: '3', date: '2026-09-23T05:36:01Z' })
    expect(r.bad).toEqual([])
    expect(r.entries).toEqual([
      { trad: '學生', simp: '学生', py: 'xue2 sheng5', defs: ['student', 'schoolchild'] },
      { trad: '中國', simp: '中国', py: 'Zhong1 guo2', defs: ['China'] },
      { trad: '%', simp: '%', py: 'pa1', defs: ['percent (Tw)'] },
    ])
  })

  it('repairs the known malformed CVDICT line and counts the fix', () => {
    const r = parseCedict('澳洲廣播電臺 澳洲广播电台 [[Ao4 zhou1 Guang3 bo1 Dian4 tai2] ] /đài ABC/\n')
    expect(r.fixesApplied['cvdict-double-bracket']).toBe(1)
    expect(r.entries[0].py).toBe('Ao4 zhou1 Guang3 bo1 Dian4 tai2')
    expect(r.bad).toEqual([])
  })

  it('reports lines it cannot parse instead of guessing', () => {
    expect(parseCedict('broken line without brackets\n').bad).toEqual(['broken line without brackets'])
  })

  it('drops empty senses and collapses pinyin spacing', () => {
    const [e] = parseCedict('好 好 [hao3  ] /good// fine /\n').entries
    expect(e.py).toBe('hao3')
    expect(e.defs).toEqual(['good', 'fine'])
  })
})

describe('keys', () => {
  it('builds and parses "trad|simp[pinyin]"', () => {
    expect(entryKey('學生', '学生', 'xue2 sheng5')).toBe('學生|学生[xue2 sheng5]')
    expect(parseKey('學生|学生[xue2 sheng5]')).toEqual({ trad: '學生', simp: '学生', py: 'xue2 sheng5' })
    expect(parseKey('学生')).toBeNull()
  })

  it('merges duplicate lines, keeping sense order', () => {
    const [entries, merged] = dedupeEntries([
      { trad: '和', simp: '和', py: 'he2', defs: ['and', 'together with'] },
      { trad: '和', simp: '和', py: 'he2', defs: ['together with', 'peace'] },
      { trad: '和', simp: '和', py: 'He2', defs: ['surname He'] },
    ])
    expect(merged).toBe(1)
    expect(entries.map((e) => [e.key, e.defs])).toEqual([
      ['和|和[he2]', ['and', 'together with', 'peace']],
      ['和|和[He2]', ['surname He']],
    ])
  })
})
