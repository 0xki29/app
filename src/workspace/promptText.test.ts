import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../test/fixtures/testChars'
import type { PracticeItem } from './practiceItem'
import { boxLabel, langOf, MASK, maskChars, promptView, recallInstruction, scriptLabel } from './promptText'

describe('recallInstruction', () => {
  it('names the script to write when the two differ', () => {
    expect(recallInstruction({ script: 'simplified' }, false)).toBe('Viết chữ giản thể từ trí nhớ')
    expect(recallInstruction({ script: 'traditional' }, false)).toBe('Viết chữ phồn thể từ trí nhớ')
    expect(recallInstruction({ script: 'both' }, false)).toBe('Viết chữ này từ trí nhớ')
  })

  it('reminds the learner once the answer has been shown', () => {
    expect(recallInstruction({ script: 'traditional' }, true)).toBe('Viết chữ phồn thể từ trí nhớ · bạn vừa xem mẫu')
  })

  it('never contains the character it asks for', () => {
    for (const c of TEST_CHARS) {
      expect(recallInstruction(c, false)).not.toContain(c.char)
      expect(recallInstruction(c, true)).not.toContain(c.char)
    }
  })
})

describe('boxLabel', () => {
  it('names the character only when it is not being recalled', () => {
    expect(boxLabel('國', false)).toBe('Ô viết chữ 國')
    expect(boxLabel('國', true)).toBe('Ô viết chữ')
  })
})

describe('script', () => {
  it('tags the font language and names the other form', () => {
    expect(langOf('traditional')).toBe('zh-Hant')
    expect(langOf('simplified')).toBe('zh-Hans')
    expect(langOf('both')).toBe('zh-Hans')
    expect(scriptLabel('simplified', '學')).toBe('Giản thể · phồn thể 學')
    expect(scriptLabel('traditional', '国')).toBe('Phồn thể · giản thể 国')
    expect(scriptLabel('both', null)).toBeNull()
  })
})

describe('promptView', () => {
  const xue: PracticeItem = {
    char: '学',
    info: { pinyin: 'xue2', hanViet: 'học', meanings: ['học', 'xem 學'], english: false, script: 'simplified', counterpart: '學' },
    infoStatus: 'ready',
    context: { key: '學生|学生[xue2 sheng5]', simp: '学生', pinyin: 'xue2 sheng5', vi: 'học sinh (学生)' },
  }

  it('shows everything outside Recall', () => {
    expect(promptView(xue, false, false)).toEqual({
      pinyin: 'xue2',
      fallback: '学',
      hanViet: 'học',
      meaning: 'học; xem 學',
      context: '学生 · học sinh (学生)',
      extra: 'Giản thể · phồn thể 學',
    })
  })

  it('in Recall, masks the character (either script) everywhere and says what to write: "＿生 · học sinh"', () => {
    const v = promptView(xue, true, false)
    expect(v).toMatchObject({ pinyin: 'xue2', hanViet: null, context: `${MASK}生 · học sinh (${MASK}生)`, extra: 'Viết chữ giản thể từ trí nhớ' })
    expect(v.meaning).toBe(`học; xem ${MASK}`)
    expect(JSON.stringify(v)).not.toMatch(/[学學]/)
  })

  it('while the dictionary loads, keeps the prompt short and never shows the character in Recall', () => {
    const loading: PracticeItem = { char: '永', info: null, infoStatus: 'loading', context: null }
    expect(promptView(loading, true, false)).toMatchObject({ pinyin: null, fallback: '…', meaning: '', context: null })
    const none: PracticeItem = { ...loading, infoStatus: 'none' }
    expect(promptView(none, true, false)).toMatchObject({ fallback: 'Nhớ lại chữ', meaning: 'Chưa có nghĩa trong từ điển' })
    expect(promptView(none, false, false)).toMatchObject({ fallback: '永' })
  })

  it('masks every occurrence (谢谢 → ＿＿)', () => {
    expect(maskChars('谢谢 · cảm ơn', ['谢', '謝'])).toBe(`${MASK}${MASK} · cảm ơn`)
    expect(maskChars('abc', [''])).toBe('abc')
  })
})
