import { describe, expect, it } from 'vitest'
import type { ScoreResult } from '../handwriting/scoring'
import { GeometryScorer } from '../handwriting/scoring/GeometryScorer'
import { StrokeDataReferenceProvider } from '../handwriting/scoring/StrokeDataReferenceProvider'
import type { ReferenceProvider, ScoringMode } from '../handwriting/scoring/types'
import type { Ink } from '../handwriting/types'
import { checkStrokes, type StrokeCheck } from '../strokes/strokeCheck'
import { fixtureLoader, fixtureStrokeData as peekStrokeData } from '../test/fixtures/strokes'
import { sourceToBox } from '../strokes/transform'
import {
  deriveHeadline,
  interruptionLines,
  previewLines,
  resultDescription,
  resultLines,
  strokeGrade,
} from './resultText'
import { summarizeStrokes, type StrokeSummary } from './strokeFeedback'

function scored(total: number, grade: ScoreResult['grade']): ScoreResult {
  return { status: 'scored', total, grade, feedback: ['Rất tốt!'] } as ScoreResult
}

function summary(counts: Partial<StrokeSummary>): StrokeSummary {
  return { good: 0, off: 0, wrong: 0, missing: 0, extra: 0, issues: [], ...counts }
}

describe('strokeGrade', () => {
  it('is excellent only when every stroke is right', () => {
    expect(strokeGrade(summary({ good: 5 }))).toBe('excellent')
    expect(strokeGrade(summary({ good: 4, off: 1 }))).toBe('good')
  })

  it('is at most fair with any stroke wrong, missing or extra', () => {
    expect(strokeGrade(summary({ good: 4, wrong: 1 }))).toBe('fair')
    expect(strokeGrade(summary({ good: 4, missing: 1 }))).toBe('fair')
    expect(strokeGrade(summary({ good: 5, extra: 1 }))).toBe('fair')
  })

  it('needs work when more than half the character is wrong or missing', () => {
    expect(strokeGrade(summary({ good: 2, wrong: 3 }))).toBe('needs-work')
    expect(strokeGrade(summary({ wrong: 5 }))).toBe('needs-work')
    expect(strokeGrade(summary({ good: 3, off: 1, missing: 2 }))).toBe('fair')
  })
})

describe('deriveHeadline', () => {
  it('without stroke data, is the score’s own grade and caption', () => {
    const h = deriveHeadline(scored(92, 'excellent'), null)
    expect(h).toMatchObject({ score: 92, caption: 'điểm phản hồi', grade: 'excellent', label: 'Rất tốt', strokes: null, tone: 'correct' })
  })

  it('with stroke data, names the number the shape score and puts the strokes in the headline', () => {
    const h = deriveHeadline(scored(97, 'excellent'), summary({ good: 5 }))
    expect(h).toMatchObject({ caption: 'điểm hình dáng', label: 'Rất tốt', strokes: '5/5 nét đúng', tone: 'correct' })
  })

  it('never says "Rất tốt" or "Khá tốt", nor pulses green, while a stroke is wrong or missing (A3)', () => {
    for (const s of [summary({ good: 4, wrong: 1 }), summary({ good: 4, missing: 1 }), summary({ good: 5, extra: 1 })]) {
      const h = deriveHeadline(scored(98, 'excellent'), s)
      expect(h.label).not.toMatch(/Rất tốt|Khá tốt/)
      expect(h.tone).not.toBe('correct')
    }
  })

  it('counts only right strokes as right: "4/5 nét đúng" with one a little off', () => {
    const h = deriveHeadline(scored(95, 'excellent'), summary({ good: 4, off: 1 }))
    expect(h).toMatchObject({ grade: 'good', strokes: '4/5 nét đúng', tone: 'correct' })
  })

  it('keeps a low score low even when every stroke is right', () => {
    const h = deriveHeadline(scored(55, 'needs-work'), summary({ good: 5 }))
    expect(h).toMatchObject({ grade: 'needs-work', tone: 'wrong' })
  })

  it('shows no number and no verdict when nothing could be scored', () => {
    const r = { status: 'insufficient-reference', total: 0, grade: 'needs-work', feedback: ['Chưa có dữ liệu mẫu.'] } as ScoreResult
    const h = deriveHeadline(r, null)
    expect(h).toMatchObject({ score: null, grade: null, label: 'Chưa chấm được', tone: 'none' })
    expect(resultLines(r, null, [], false)).toEqual(['Chưa có dữ liệu mẫu.'])
  })
})

describe('resultLines / resultDescription', () => {
  const lowScore = { status: 'scored', total: 74, grade: 'fair', feedback: ['Khá ổn, thử chú ý hơn đến vị trí và độ dài nét.'] } as ScoreResult

  it('with stroke data: the stroke issues, then lines about cut strokes', () => {
    const s = summary({ good: 4, wrong: 1, issues: ['Nét 2: ngược chiều'] })
    expect(resultLines(scored(90, 'excellent'), s, ['Nét 3: bị ngắt giữa chừng'], true)).toEqual(['Nét 2: ngược chiều', 'Nét 3: bị ngắt giữa chừng'])
  })

  it('says why when the score, not the strokes, holds the verdict down: never a lowered verdict with no reason (SC-6)', () => {
    const allRight = summary({ good: 11 })
    expect(deriveHeadline(lowScore, allRight).label).toBe('Cần luyện thêm')
    expect(resultLines(lowScore, allRight, [], true)).toEqual(lowScore.feedback)
    // The strokes set the verdict: their issues say it all.
    expect(resultLines(lowScore, summary({ good: 3, missing: 2, issues: ['Nét 4–5: thiếu'] }), [], true)).toEqual(['Nét 4–5: thiếu'])
    expect(resultLines(scored(97, 'excellent'), allRight, [], true)).toEqual([])
  })

  it('without stroke data: the scorer’s lines, or after the reveal what to do next', () => {
    expect(resultLines(lowScore, null, [], false)).toEqual(lowScore.feedback)
    expect(resultLines(lowScore, null, [], true)).toEqual(['So sánh chữ của bạn với mẫu, rồi tự đánh giá.'])
  })

  it('describes the result as one sentence per line', () => {
    expect(resultDescription(['Nét 2: ngược chiều', 'Nét 5: thiếu'])).toBe('Nét 2: ngược chiều. Nét 5: thiếu.')
    expect(resultDescription(['Khá ổn, thử chú ý hơn.'])).toBe('Khá ổn, thử chú ý hơn.')
    expect(resultDescription([])).toBe('')
  })
})

describe('interruptionLines', () => {
  const check = (verdicts: ('good' | 'off')[]): StrokeCheck =>
    ({ user: verdicts.map((verdict, k) => ({ verdict, issue: null, ref: k })) }) as unknown as StrokeCheck

  it('flags a cut stroke that did not come out right, by its reference number', () => {
    expect(interruptionLines(['up', 'cancel', 'interrupted'], check(['good', 'off', 'good']))).toEqual(['Nét 2: bị ngắt giữa chừng'])
  })

  it('says nothing about strokes lifted normally, or lost lifts', () => {
    expect(interruptionLines(['up', 'lost', undefined], check(['off', 'off', 'off']))).toEqual([])
  })

  it('without a stroke check, says it once', () => {
    expect(interruptionLines(['cancel', 'cancel'], null)).toEqual(['Có nét bị ngắt giữa chừng'])
  })

  it('says nothing about a tap, which is no stroke', () => {
    const tap = { user: [{ verdict: 'off', issue: 'tap', ref: null }] } as unknown as StrokeCheck
    expect(interruptionLines(['interrupted'], tap)).toEqual([])
  })
})

describe('previewLines', () => {
  it('shows the first lines and counts the rest', () => {
    expect(previewLines(['a', 'b'])).toEqual({ shown: ['a', 'b'], more: 0 })
    expect(previewLines(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 })
  })
})

describe('A3 end to end: 永 written with every stroke reversed', () => {
  const noFallback: ReferenceProvider = {
    getReference: () => Promise.reject(new Error('stroke data expected')),
  }

  it.each<ScoringMode>(['trace', 'recall'])('%s: a high shape score, but the headline says the strokes are wrong', async (mode) => {
    const data = peekStrokeData('永')!
    const ink: Ink = {
      strokes: data.medians.map((m) => ({
        pointerType: 'touch',
        points: densify(m.map(([x, y]) => sourceToBox(x, y)))
          .reverse()
          .map((p, i) => ({ ...p, t: i * 8, p: 0.5 })),
      })),
    }
    const reference = await new StrokeDataReferenceProvider(noFallback, fixtureLoader).getReference('永', 'zh-Hans', 5)
    const result = await new GeometryScorer().score(ink, reference, mode)
    const s = summarizeStrokes(checkStrokes(ink, data, mode))
    const h = deriveHeadline(result, s)

    // The geometry alone cannot see direction: without the stroke check this was "Rất tốt".
    expect(result.grade).toBe('excellent')
    expect(s.wrong).toBe(5)
    expect(h).toMatchObject({ grade: 'needs-work', label: 'Thử lại', strokes: '0/5 nét đúng', tone: 'wrong' })
  })
})

function densify(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01))
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}
