import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCedict } from '../lib/cedict.mjs'
import { createHanViet, parseWordlist, readCharTable, taiwanReading, wordReading } from '../lib/hanviet.mjs'
import { readCuratedTsv } from '../lib/overrides.mjs'
import { GOLDEN_DIR, NODE_MODULES, OVERRIDES_DIR } from '../lib/paths.mjs'
import { syllables } from '../lib/pinyin.mjs'
import { parseUnihanText } from '../lib/unihan.mjs'
import { normalizeHvSyllable } from '../lib/vietnamese.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')

// The real word list (a devDependency, no network) and character table (data/overrides), with the
// fixtures' CC-CEDICT and Unihan excerpts.
const wordlist = parseWordlist(fs.readFileSync(path.join(NODE_MODULES, 'hanviet-pinyin-words/src/hanvietData.js'), 'utf8'))
const entries = parseCedict(fixture('gold-cedict.u8')).entries
const unihan = parseUnihanText(fixture('gold-unihan.txt'))
const readings = new Map()
for (const e of entries) readings.set(e.trad, [...(readings.get(e.trad) ?? []), syllables(e.py)])
const charTable = readCharTable(readCuratedTsv(fs.readFileSync(path.join(OVERRIDES_DIR, 'hanviet-char.tsv'), 'utf8')))
const hv = createHanViet({ wordlist, unihan, readingsOf: (t) => readings.get(t) ?? [], charTable })
const bare = createHanViet({ wordlist, unihan, readingsOf: (t) => readings.get(t) ?? [] })

const read = (trad, py, defs = []) => wordReading(hv.resolveChars(trad, syllables(py), { taiwan: taiwanReading(defs) }))?.hv ?? ''
const same = (a, b) => a.split(' ').map(normalizeHvSyllable).join(' ') === b.split(' ').map(normalizeHvSyllable).join(' ')

const gold = fs
  .readFileSync(path.join(GOLDEN_DIR, 'hanviet-gold.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const [simp, trad, py, want] = l.split('\t')
    return { simp, trad, py, want: want.split('|') }
  })

describe('Hán Việt on the gold set (polyphones and vernacular-first characters)', () => {
  const results = gold.map((g) => {
    const e = entries.find((x) => x.trad === g.trad && x.py.toLowerCase() === g.py.toLowerCase())
    const got = read(g.trad, g.py, e?.defs)
    return { ...g, got, ok: g.want.some((w) => same(w, got)) }
  })

  it('misses at most 2 (the build gate)', () => {
    const misses = results.filter((r) => !r.ok).map((r) => `${r.simp}: ${r.got} ≠ ${r.want.join('|')}`)
    expect(results.length).toBe(46)
    expect(misses.length, misses.join('; ')).toBeLessThanOrEqual(2)
  })

  it('reads the character table first: the Sino-Vietnamese reading, never the vernacular one', () => {
    const d = entries.find((x) => x.trad === '讀者')
    expect(wordReading(bare.resolveChars('讀者', syllables(d.py)))?.hv).toBe('đọc giả')
    expect(read('讀者', 'du2 zhe3')).toBe('độc giả')
    expect(read('享受', 'xiang3 shou4')).toBe('hưởng thụ')
    expect(read('開幕', 'kai1 mu4')).toBe('khai mạc')
    // '*' rows cover every reading of the character, a proper noun's included
    expect(wordReading(hv.resolveChars('冷', ['Leng3']), { properNoun: true })?.hv).toBe('Lãnh')
    const r = wordReading(hv.resolveChars('睡覺', ['shui4', 'jiao4']))
    expect(r).toMatchObject({ hv: 'thuỵ giác', alts: ['thuỵ giáo'], curated: 'ai-draft', low: false })
  })

  it('reads polyphones by the entry’s pinyin, from the traditional form', () => {
    expect(read('銀行', 'yin2 hang2')).toBe('ngân hàng')
    expect(read('行人', 'xing2 ren2')).toBe('hành nhân')
    expect(read('校長', 'xiao4 zhang3')).toBe('hiệu trưởng')
    expect(read('頭髮', 'tou2 fa5')).toBe('đầu phát')
    expect(read('麵條', 'mian4 tiao2')).toBe('miến điều')
    expect(read('幹部', 'gan4 bu4')).toBe('cán bộ')
  })

  it('resolves a neutral tone through the gloss’s "Taiwan pr."', () => {
    const e = entries.find((x) => x.trad === '部分' && x.py === 'bu4 fen5')
    expect(taiwanReading(e.defs)).toEqual(['bu4', 'fen4'])
    expect(read('部分', 'bu4 fen5', e.defs)).toBe('bộ phận')
  })

  it('leaves the two conventional readings pinyin cannot predict to the word overrides', () => {
    expect(results.filter((r) => !r.ok).map((r) => r.simp)).toEqual(['调查', '将军'])
  })
})

describe('the character table', () => {
  const row = (char, pinyin, hanviet, vernacular = '-') => ({ char, pinyin, hanviet, vernacular, reason: 'r', source: 's', status: 'ai-draft' })
  it('reads rows by character and pinyin, normalizing spelling', () => {
    const t = readCharTable([row('冷', '*', 'lãnh', 'lạnh'), row('絲', 'si1', 'ti', 'tơ')])
    expect(t.get('冷\t*')).toEqual({ readings: ['lãnh'], vernacular: ['lạnh'], status: 'ai-draft' })
    expect(t.get('絲\tsi1').readings).toEqual(['ty'])
  })
  it('rejects what cannot be right', () => {
    expect(() => readCharTable([row('冷冷', '*', 'lãnh')])).toThrow(/one Han character/)
    expect(() => readCharTable([row('冷', 'Leng3', 'lãnh')])).toThrow(/pinyin/)
    expect(() => readCharTable([row('冷', '*', 'lãnh'), row('冷', '*', 'lãnh')])).toThrow(/two rows/)
    expect(() => readCharTable([row('冷', '*', 'lãnh', 'lãnh')])).toThrow(/both a reading and a vernacular/)
  })
})

describe('wordReading', () => {
  const resolved = (list) => list.map(([ch, cands, how = 'exact']) => ({ ch, han: /\p{Script=Han}/u.test(ch), cands, how }))

  it('keeps runs of letters and digits as one token and drops punctuation', () => {
    expect(wordReading(resolved([['X', ['X'], 'pass'], ['光', ['quang']]])).hv).toBe('X quang')
    expect(wordReading(resolved([['卡', ['khải']], ['拉', ['lạp']], ['O', ['O'], 'pass'], ['K', ['K'], 'pass']])).hv).toBe('khải lạp OK')
    expect(wordReading(resolved([['一', ['nhất']], ['·', ['·'], 'pass'], ['二', ['nhị']]])).hv).toBe('nhất nhị')
  })

  it('offers one-character alternates, same syllable count only', () => {
    const r = wordReading(resolved([['睡', ['thuỵ']], ['覺', ['giác', 'giáo']]]))
    expect(r).toEqual({ hv: 'thuỵ giác', alts: ['thuỵ giáo'], low: false, nom: false, curated: null })
    expect(wordReading(resolved([['圕', ['thoan', 'đồ thư quán']]])).alts).toEqual([])
  })

  it('capitalizes every syllable of a proper noun', () => {
    expect(wordReading(resolved([['長', ['trường']], ['城', ['thành']]]), { properNoun: true }).hv).toBe('Trường Thành')
  })

  it('returns null rather than a partial reading, and flags Unihan fallbacks', () => {
    expect(wordReading(resolved([['鶥', [], 'none'], ['鳥', ['điểu']]]))).toBeNull()
    expect(wordReading(resolved([['3', ['3'], 'pass']]))).toBeNull()
    expect(wordReading(resolved([['年', ['nên'], 'unihan']]))).toMatchObject({ low: true, nom: true })
    // the list's reading under another pinyin: low confidence, but no reason to suspect Nôm
    expect(wordReading(resolved([['咖', ['ca'], 'other-reading']]))).toMatchObject({ low: true, nom: false })
  })
})
