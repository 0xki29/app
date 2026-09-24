import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../data/testChars'
import { boxLabel, recallInstruction } from './promptText'

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
