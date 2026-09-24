import { describe, expect, it } from 'vitest'
import type { RefStrokeCheck, StrokeCheck, UserStrokeCheck } from '../strokes/strokeCheck'
import { strokeIssueLines, summarizeStrokes } from './strokeFeedback'

const good = (i: number): [UserStrokeCheck, RefStrokeCheck] => [
  { verdict: 'good', issue: null, ref: i },
  { verdict: 'good', issue: null, user: [i] },
]
const missing: RefStrokeCheck = { verdict: 'missing', issue: null, user: [] }

describe('summarizeStrokes', () => {
  it('counts verdicts and has nothing to say when all is right', () => {
    const pairs = [good(0), good(1), good(2)]
    const check: StrokeCheck = { user: pairs.map((p) => p[0]), reference: pairs.map((p) => p[1]), missing: [], referenceToInk: null }
    expect(summarizeStrokes(check)).toEqual({ good: 3, off: 0, wrong: 0, missing: 0, extra: 0, issues: [] })
  })

  it('names each issue by the reference stroke’s number, in stroke order', () => {
    const check: StrokeCheck = {
      user: [
        { verdict: 'good', issue: null, ref: 0 },
        { verdict: 'wrong', issue: 'order', ref: 3 },
        { verdict: 'wrong', issue: 'reversed', ref: 1 },
        { verdict: 'off', issue: 'split', ref: 2 },
        { verdict: 'off', issue: 'split', ref: 2 },
      ],
      reference: [
        { verdict: 'good', issue: null, user: [0] },
        { verdict: 'wrong', issue: 'reversed', user: [2] },
        { verdict: 'off', issue: 'split', user: [3, 4] },
        { verdict: 'wrong', issue: 'order', user: [1] },
      ],
      missing: [],
      referenceToInk: null,
    }
    expect(strokeIssueLines(check)).toEqual(['Nét 2: ngược chiều', 'Nét 3: viết thành 2 nét', 'Nét 4: sai thứ tự'])
    const s = summarizeStrokes(check)
    expect([s.good, s.off, s.wrong, s.missing, s.extra]).toEqual([1, 1, 2, 0, 0])
  })

  it('groups missing strokes and a join into ranges; extra strokes come last, outside the counts', () => {
    const check: StrokeCheck = {
      user: [
        { verdict: 'off', issue: 'merged', ref: 0 },
        { verdict: 'wrong', issue: 'extra', ref: null },
        { verdict: 'off', issue: 'tap', ref: null },
        { verdict: 'wrong', issue: 'extra', ref: null },
        { verdict: 'off', issue: 'misplaced', ref: 4 },
      ],
      reference: [
        { verdict: 'off', issue: 'merged', user: [0] },
        { verdict: 'off', issue: 'merged', user: [0] },
        missing,
        missing,
        { verdict: 'off', issue: 'misplaced', user: [4] },
        missing,
      ],
      missing: [2, 3, 5],
      referenceToInk: null,
    }
    const all = ['Nét 1–2: viết liền thành 1 nét', 'Nét 3–4: thiếu', 'Nét 5: lệch vị trí', 'Nét 6: thiếu', '2 nét thừa']
    expect(strokeIssueLines(check)).toEqual(all)
    const s = summarizeStrokes(check)
    // Counts are over the character's 6 strokes; the two extras and the tap are not among them.
    expect([s.good, s.off, s.wrong, s.missing, s.extra]).toEqual([0, 3, 0, 3, 2])
    expect(s.issues).toEqual(all)
  })

  it('says "Nét thừa" for a single extra stroke', () => {
    const [u, r] = good(0)
    const check: StrokeCheck = {
      user: [u, { verdict: 'wrong', issue: 'extra', ref: null }],
      reference: [r],
      missing: [],
      referenceToInk: null,
    }
    expect(summarizeStrokes(check).issues).toEqual(['Nét thừa'])
  })
})
