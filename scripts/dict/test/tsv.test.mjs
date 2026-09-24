import { describe, expect, it } from 'vitest'
import { COLUMNS, formatRow, formatShard, parseRow, parseShard } from '../lib/tsv.mjs'

const row = {
  simp: '学生',
  trad: '學生',
  pinyin: 'xue2 sheng5',
  hv: 'học sinh',
  hvAlt: [],
  vi: ['học sinh; sinh viên', 'Lượng từ: 个 (gè)'],
  en: [],
  hsk: 1,
  pop: 77,
  flags: ['cur-ai'],
}

describe('shard rows', () => {
  it('has the contract’s ten columns', () => {
    expect(COLUMNS).toEqual(['simp', 'trad', 'pinyin', 'hv', 'hvAlt', 'vi', 'en', 'hsk', 'pop', 'flags'])
    expect(formatRow(row).split('\t')).toHaveLength(10)
  })

  it('round-trips', () => {
    expect(parseRow(formatRow(row))).toEqual(row)
    const other = { ...row, simp: '行', trad: '行', pinyin: 'hang2', hv: 'hàng', hvAlt: ['hạng'], vi: [], en: ['row', 'line'], hsk: null, pop: 0, flags: ['en'] }
    expect(parseRow(formatRow(other))).toEqual(other)
  })

  it('writes trad as empty when it equals simp, and reads it back in full', () => {
    const same = { ...row, simp: '好', trad: '好' }
    expect(formatRow(same).split('\t')[1]).toBe('')
    expect(parseRow(formatRow(same)).trad).toBe('好')
  })

  it('refuses values that would break the format', () => {
    expect(() => formatRow({ ...row, vi: ['a/b'] })).toThrow(/separator/)
    expect(() => formatRow({ ...row, hvAlt: ['a|b'] })).toThrow(/separator/)
    expect(() => formatRow({ ...row, flags: ['a,b'] })).toThrow(/separator/)
    expect(() => formatRow({ ...row, hv: 'a\tb' })).toThrow(/separator/)
    expect(() => formatRow({ ...row, pop: 101 })).toThrow(/pop/)
    expect(() => parseRow('a\tb')).toThrow(/columns/)
  })

  it('separates shard rows with LF and adds no trailing LF, so split("\\n") gives the rows', () => {
    const text = formatShard([row, row])
    expect(text.endsWith('\n')).toBe(false)
    expect(text.split('\n')).toHaveLength(2)
    expect(parseShard(text)).toEqual([row, row])
    expect(parseShard('')).toEqual([])
  })
})
