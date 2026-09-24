import { describe, expect, it } from 'vitest'
import { practiceInfo, readingInWord, topSenses, tradInWord, type CharInfoLike, type PracticeContext } from './practiceItem'

type E = CharInfoLike['entries'][number]
/** A row of `simp` (traditional form `trad`), most common first as the dictionary lists them. */
const row = (simp: string, trad: string, pinyin: string, hv: string, vi: string[], extra: Partial<E> = {}): E => ({
  key: `${trad}|${simp}[${pinyin}]`,
  simp,
  trad,
  pinyin,
  hv,
  vi,
  en: [],
  flags: [],
  ...extra,
})
const entry = (pinyin: string, hv: string, vi: string[], extra: Partial<E> = {}): E => row('行', '行', pinyin, hv, vi, extra)

/** A test double of the dictionary's CharInfo for 行 (two readings). */
const HANG: CharInfoLike = {
  script: 'both',
  counterpart: null,
  entries: [
    entry('xing2', 'hành', ['đi', 'được, ổn', 'Lượng từ: 行 hàng']),
    entry('hang2', 'hàng', ['hàng, dãy', 'nghề nghiệp']),
    entry('Xing2', 'Hành', ['họ Hành'], { flags: ['pn'] }),
  ],
}

const XUE: CharInfoLike = {
  script: 'simplified',
  counterpart: '學',
  entries: [row('学', '學', 'xue2', 'học', ['học (tập) (nghĩa cũ)', 'học thuyết', 'trường học'])],
}

const YINHANG: PracticeContext = { key: '銀行|银行[yin2 hang2]', simp: '银行', pinyin: 'yin2 hang2', vi: 'ngân hàng' }
const XUESHENG: PracticeContext = { key: '學生|学生[xue2 sheng5]', simp: '学生', pinyin: 'xue2 sheng5', vi: 'học sinh' }

describe('practiceInfo', () => {
  it('uses the character’s most common reading without a context word', () => {
    expect(practiceInfo(HANG, '行', null)).toEqual({
      pinyin: 'xing2',
      hanViet: 'hành',
      meanings: ['đi', 'được, ổn'],
      english: false,
      script: 'both',
      counterpart: null,
    })
  })

  it('uses the reading the character has in its word (行 in 银行 is háng)', () => {
    expect(practiceInfo(HANG, '行', YINHANG)).toMatchObject({ pinyin: 'hang2', hanViet: 'hàng', meanings: ['hàng, dãy', 'nghề nghiệp'] })
  })

  it('matches a neutral tone in the word to the character’s own tone (生 in 学生 xue2 sheng5 is shēng)', () => {
    const sheng: CharInfoLike = { script: 'both', counterpart: null, entries: [entry('sheng1', 'sinh', ['sinh ra'])] }
    expect(practiceInfo(sheng, '生', XUESHENG)).toMatchObject({ pinyin: 'sheng1', hanViet: 'sinh' })
  })

  it('keeps the script and counterpart; a short note that narrows a word stays, other notes and classifier lines go', () => {
    expect(practiceInfo(XUE, '学', XUESHENG)).toEqual({
      pinyin: 'xue2',
      hanViet: 'học',
      meanings: ['học (tập)', 'học thuyết'],
      english: false,
      script: 'simplified',
      counterpart: '學',
    })
  })

  it('falls back to English, flagged, when the reading has no Vietnamese', () => {
    const info: CharInfoLike = { script: 'both', counterpart: null, entries: [entry('ding1', '', [], { en: ['nail', 'nail'] })] }
    expect(practiceInfo(info, '丁', null)).toMatchObject({ meanings: ['nail'], english: true, hanViet: '' })
  })

  it('prefers a reading that is not a name or a variant form', () => {
    const info: CharInfoLike = {
      script: 'both',
      counterpart: null,
      entries: [entry('Zhang1', 'Trương', ['họ Trương'], { flags: ['pn'] }), entry('zhang1', 'trương', ['mở ra'])],
    }
    expect(practiceInfo(info, '张', null)?.meanings).toEqual(['mở ra'])
  })

  it('without dictionary data, gives what the context word says (its reading), else nothing', () => {
    expect(practiceInfo(null, '行', YINHANG)).toEqual({ pinyin: 'hang2', hanViet: '', meanings: [], english: false, script: 'both', counterpart: null })
    expect(practiceInfo(null, '行', null)).toBeNull()
    expect(practiceInfo({ script: 'both', counterpart: null, entries: [] }, '行', null)).toBeNull()
  })

  it('takes the row of the word’s traditional form (发 in 头发 is 髮 “tóc”, not 發 “gửi”)', () => {
    const fa: CharInfoLike = {
      script: 'simplified',
      counterpart: '發',
      entries: [row('发', '發', 'fa1', 'phát', ['gửi; gửi đi']), row('发', '髮', 'fa4', 'phát', ['tóc'])],
    }
    const toufa: PracticeContext = { key: '頭髮|头发[tou2 fa5]', simp: '头发', pinyin: 'tou2 fa5', vi: 'tóc' }
    expect(practiceInfo(fa, '发', toufa)).toMatchObject({ pinyin: 'fa4', meanings: ['tóc'] })
    expect(practiceInfo(fa, '发', null)).toMatchObject({ pinyin: 'fa1', meanings: ['gửi; gửi đi'] })
  })

  it('never shows a classical row that only stands in for another form (台 “ông; biến thể của 臺”)', () => {
    const tai: CharInfoLike = {
      script: 'both',
      counterpart: null,
      entries: [
        row('台', '台', 'tai2', 'đài', ['(văn cổ) ông (trong thư từ)', 'biến thể của 臺|台[tai2]']),
        row('台', '臺', 'tai2', 'đài', ['bục', 'sân khấu']),
      ],
    }
    const wutai: PracticeContext = { key: '舞台|舞台[wu3 tai2]', simp: '舞台', pinyin: 'wu3 tai2', vi: 'sân khấu' }
    expect(practiceInfo(tai, '台', wutai)?.meanings).toEqual(['bục', 'sân khấu'])
    expect(practiceInfo(tai, '台', null)?.meanings).toEqual(['bục', 'sân khấu'])
  })

  it('reads a capitalized syllable as the name row unless the word itself is a name (汉 in 汉语; 中 in 中国)', () => {
    const han: CharInfoLike = {
      script: 'simplified',
      counterpart: '漢',
      entries: [row('汉', '漢', 'han4', 'hán', ['đàn ông']), row('汉', '漢', 'Han4', 'Hán', ['dân tộc Hán'], { flags: ['pn'] })],
    }
    const hanyu: PracticeContext = { key: '漢語|汉语[Han4 yu3]', simp: '汉语', pinyin: 'Han4 yu3', vi: 'tiếng Hán' }
    expect(practiceInfo(han, '汉', hanyu)?.meanings).toEqual(['dân tộc Hán'])
    const zhong: CharInfoLike = {
      script: 'both',
      counterpart: null,
      entries: [row('中', '中', 'zhong1', 'trung', ['giữa']), row('中', '中', 'Zhong1', 'Trung', ['Trung Quốc'], { flags: ['pn'] })],
    }
    const zhongguo: PracticeContext = { key: '中國|中国[Zhong1 guo2]', simp: '中国', pinyin: 'Zhong1 guo2', vi: 'Trung Quốc', pn: true }
    expect(practiceInfo(zhong, '中', zhongguo)?.meanings).toEqual(['giữa'])
  })

  it('does not show a loanword’s "-" as its Hán Việt', () => {
    const info: CharInfoLike = { script: 'both', counterpart: null, entries: [entry('ka3', '-', ['thẻ'])] }
    expect(practiceInfo(info, '卡', null)?.hanViet).toBe('')
  })
})

describe('readingInWord', () => {
  it('reads one syllable per character', () => {
    expect(readingInWord('生', XUESHENG)).toBe('sheng5')
    expect(readingInWord('点', { simp: '一点儿', pinyin: 'yi1 dian3 r5' })).toBe('dian3')
  })

  it('gives up when the word does not line up or lacks the character', () => {
    expect(readingInWord('生', { simp: '学生', pinyin: 'xuesheng' })).toBeNull()
    expect(readingInWord('永', XUESHENG)).toBeNull()
  })
})

describe('tradInWord', () => {
  it('reads the traditional form at the character’s place in the word’s key', () => {
    expect(tradInWord('发', { key: '頭髮|头发[tou2 fa5]', simp: '头发' })).toBe('髮')
    expect(tradInWord('学', { key: '學生|学生[xue2 sheng5]', simp: '学生' })).toBe('學')
    expect(tradInWord('永', { key: '學生|学生[xue2 sheng5]', simp: '学生' })).toBeNull()
  })
})

describe('topSenses', () => {
  it('takes distinct senses as a list row shows them, skipping classifiers and senses that differ only in a note', () => {
    expect(topSenses(['CL:個|个[ge4]', 'a (note) b', 'a  b', 'c'], 2)).toEqual(['a (note) b', 'c'])
    expect(topSenses(['(sau số đếm) giờ (vd. 三点: ba giờ)', 'điểm'], 2)).toEqual(['giờ', 'điểm'])
  })
})
