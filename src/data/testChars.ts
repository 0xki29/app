/** Prototype-only data for the handwriting workspace. This is not the content system. */
export interface TestChar {
  char: string
  /** Script of `char`. 'both' = the same glyph in simplified and traditional. */
  script: 'simplified' | 'traditional' | 'both'
  /** The same character in the other script, when it differs. */
  counterpart?: string
  pinyin: string
  hanViet: string
  meaningVi: string
  note?: string
}

export const TEST_CHARS: readonly TestChar[] = [
  {
    char: '永',
    script: 'both',
    pinyin: 'yǒng',
    hanViet: 'vĩnh',
    meaningVi: 'mãi mãi, lâu dài',
    note: 'Chữ kinh điển để luyện 8 nét cơ bản (永字八法)',
  },
  {
    char: '你',
    script: 'both',
    pinyin: 'nǐ',
    hanViet: 'nhĩ',
    meaningVi: 'bạn, anh, chị (ngôi thứ hai)',
  },
  {
    char: '学',
    script: 'simplified',
    counterpart: '學',
    pinyin: 'xué',
    hanViet: 'học',
    meaningVi: 'học',
  },
  {
    char: '國',
    script: 'traditional',
    counterpart: '国',
    pinyin: 'guó',
    hanViet: 'quốc',
    meaningVi: 'nước, quốc gia',
  },
  {
    char: '謝',
    script: 'traditional',
    counterpart: '谢',
    pinyin: 'xiè',
    hanViet: 'tạ',
    meaningVi: 'cảm ơn, tạ ơn',
    note: '谢谢 xièxie = cảm ơn',
  },
]

/** BCP 47 tag so CJK fonts pick the right regional glyphs. */
export function langOf(c: TestChar): string {
  return c.script === 'traditional' ? 'zh-Hant' : 'zh-Hans'
}

export function scriptLabel(c: TestChar): string | null {
  if (!c.counterpart) return null
  return c.script === 'traditional' ? `Phồn thể · giản thể ${c.counterpart}` : `Giản thể · phồn thể ${c.counterpart}`
}
