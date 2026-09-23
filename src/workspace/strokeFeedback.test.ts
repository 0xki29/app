import { describe, expect, it } from 'vitest'
import type { StrokeCheck, UserStrokeCheck } from '../strokes/strokeCheck'
import { summarizeStrokes } from './strokeFeedback'

const good: UserStrokeCheck = { verdict: 'good', issue: null, looksLike: null }

describe('summarizeStrokes', () => {
  it('counts verdicts and has nothing to say when all is right', () => {
    expect(summarizeStrokes({ user: [good, good, good], missing: [], referenceToInk: null })).toEqual({
      good: 3,
      off: 0,
      wrong: 0,
      missing: 0,
      issues: [],
    })
  })

  it('names each issue by stroke number, order issues by the stroke they resemble', () => {
    const check: StrokeCheck = {
      user: [
        good,
        { verdict: 'wrong', issue: 'reversed', looksLike: null },
        { verdict: 'wrong', issue: 'order', looksLike: 3 },
        { verdict: 'off', issue: 'short', looksLike: null },
      ],
      missing: [],
      referenceToInk: null,
    }
    expect(summarizeStrokes(check).issues).toEqual(['Nét 2: ngược chiều', 'Nét 3: sai thứ tự (là nét 4)', 'Nét 4: hơi ngắn'])
  })

  it('groups missing strokes into ranges and caps the list', () => {
    const check: StrokeCheck = {
      user: [
        { verdict: 'off', issue: 'misplaced', looksLike: null },
        { verdict: 'wrong', issue: 'unmatched', looksLike: null },
      ],
      missing: [2, 3, 5],
      referenceToInk: null,
    }
    const s = summarizeStrokes(check)
    expect(s.missing).toBe(3)
    expect(s.issues).toEqual(['Nét 1: lệch vị trí', 'Nét 2: chưa đúng nét', 'Nét 3–4: thiếu', '+ 1 lỗi khác'])
  })
})
