/**
 * Test fixtures: the five characters the stroke, scoring and review tests run on (their stroke data
 * is in ./strokes/). Not app data: the app gets characters from the review deck and the dictionary.
 */
export interface TestChar {
  char: string
  /** Script of `char`. 'both' = the same glyph in simplified and traditional. */
  script: 'simplified' | 'traditional' | 'both'
  /** The same character in the other script, when it differs. */
  counterpart?: string
  pinyin: string
  hanViet: string
  meaningVi: string
  /** Standard total stroke count (Unicode Unihan kTotalStrokes). */
  strokeCount: number
  note?: string
}

export const TEST_CHARS: readonly TestChar[] = [
  {
    char: '永',
    strokeCount: 5,
    script: 'both',
    pinyin: 'yǒng',
    hanViet: 'vĩnh',
    meaningVi: 'mãi mãi, lâu dài',
    note: 'Chữ kinh điển để luyện 8 nét cơ bản (永字八法)',
  },
  {
    char: '你',
    strokeCount: 7,
    script: 'both',
    pinyin: 'nǐ',
    hanViet: 'nhĩ',
    meaningVi: 'bạn, anh, chị (ngôi thứ hai)',
  },
  {
    char: '学',
    strokeCount: 8,
    script: 'simplified',
    counterpart: '學',
    pinyin: 'xué',
    hanViet: 'học',
    meaningVi: 'học',
  },
  {
    char: '國',
    strokeCount: 11,
    script: 'traditional',
    counterpart: '国',
    pinyin: 'guó',
    hanViet: 'quốc',
    meaningVi: 'nước, quốc gia',
  },
  {
    char: '謝',
    strokeCount: 17,
    script: 'traditional',
    counterpart: '谢',
    pinyin: 'xiè',
    hanViet: 'tạ',
    meaningVi: 'cảm ơn, tạ ơn',
    note: '谢谢 xièxie = cảm ơn',
  },
]
