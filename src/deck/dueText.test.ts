import { describe, expect, it } from 'vitest'
import { isDue } from './scheduler'
import { cardDueText, dueText } from './dueText'

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime()

describe('dueText', () => {
  const now = at(24, 21)

  it('says minutes and hours within the learning day', () => {
    expect(dueText(now - 1, now, 4)).toBe('bây giờ')
    expect(dueText(now + 30_000, now, 4)).toBe('sau 1 phút')
    expect(dueText(now + 10 * 60_000, now, 4)).toBe('sau 10 phút')
    expect(dueText(at(25, 2), now, 4)).toBe('sau 5 giờ')
  })

  it('counts learning days, which start at 04:00', () => {
    expect(dueText(at(25, 5), now, 4)).toBe('ngày mai')
    expect(dueText(at(26, 3), now, 4)).toBe('ngày mai')
    expect(dueText(at(26, 9), now, 4)).toBe('sau 2 ngày')
  })

  it('gives a date beyond a month', () => {
    expect(dueText(new Date(2026, 11, 3, 9).getTime(), now, 4)).toBe('ngày 3/12/2026')
  })
})

describe('cardDueText', () => {
  const now = at(24, 8)

  it('says a review card due later today is due now, as Hôm nay counts it (DECK-4)', () => {
    const review = { state: 'review' as const, due: at(24, 20) }
    expect(isDue(review, now, 4)).toBe(true)
    expect(cardDueText(review, now, 4)).toBe('bây giờ')
    expect(cardDueText({ state: 'review', due: at(25, 20) }, now, 4)).toBe('ngày mai')
    expect(cardDueText({ state: 'review', due: at(27, 2) }, now, 4)).toBe('sau 2 ngày')
  })

  it('keeps minutes and hours for learning steps', () => {
    expect(cardDueText({ state: 'learning', due: now + 10 * 60_000 }, now, 4)).toBe('sau 10 phút')
    expect(cardDueText({ state: 'relearning', due: at(24, 11) }, now, 4)).toBe('sau 3 giờ')
  })
})
