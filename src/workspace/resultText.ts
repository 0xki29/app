import { GRADE_LABEL, type Grade, type ScoreResult } from '../handwriting/scoring'
import type { StrokeEnd } from '../handwriting/types'
import type { StrokeCheck } from '../strokes/strokeCheck'
import type { StrokeSummary } from './strokeFeedback'

/**
 * What the result panel says, derived from the score and the stroke-by-stroke check (pure; tested
 * in resultText.test.ts).
 *
 * The score measures geometry — how close the ink lies to the reference's shape. It cannot see
 * direction or order: five strokes of 永 all written backwards trace the same shape and score 98.
 * So with stroke data the number is labelled as the shape score, the stroke tally becomes part of
 * the headline, and the verdict is the lower of what the score and the strokes say: never "Rất tốt"
 * or "Khá tốt" (nor a green pulse) while a stroke is wrong, missing or extra.
 */

export type Tone = 'correct' | 'close' | 'wrong' | 'none'

export interface Headline {
  /** The big number (the scorer's total); null when nothing could be scored. */
  score: number | null
  /** Under the number: what it measures. */
  caption: string
  /** The verdict after the stroke check; null when not scored. */
  grade: Grade | null
  label: string
  /** "4/5 nét đúng" — characters with stroke data only. */
  strokes: string | null
  /** Color of the verdict, the number and the box pulse. */
  tone: Tone
}

const GRADE_RANK: Record<Grade, number> = { 'needs-work': 0, fair: 1, good: 2, excellent: 3 }

const GRADE_TONE: Record<Grade, Tone> = {
  excellent: 'correct',
  good: 'correct',
  fair: 'close',
  'needs-work': 'wrong',
}

/**
 * The best verdict the strokes allow. All right → excellent; some a little off (misplaced, short,
 * in two pieces) → good; any wrong, missing or extra → fair, or needs-work when that is more than
 * half the character.
 */
export function strokeGrade(s: StrokeSummary): Grade {
  const total = s.good + s.off + s.wrong + s.missing
  const bad = s.wrong + s.missing + s.extra
  if (bad === 0) return s.off === 0 ? 'excellent' : 'good'
  return bad * 2 <= total ? 'fair' : 'needs-work'
}

export function deriveHeadline(result: ScoreResult, summary: StrokeSummary | null): Headline {
  if (result.status !== 'scored') {
    return { score: null, caption: 'điểm phản hồi', grade: null, label: 'Chưa chấm được', strokes: null, tone: 'none' }
  }
  let grade = result.grade
  if (summary) {
    const cap = strokeGrade(summary)
    if (GRADE_RANK[cap] < GRADE_RANK[grade]) grade = cap
  }
  const total = summary ? summary.good + summary.off + summary.wrong + summary.missing : 0
  return {
    score: result.total,
    caption: summary ? 'điểm hình dáng' : 'điểm phản hồi',
    grade,
    label: GRADE_LABEL[grade],
    strokes: summary ? `${summary.good}/${total} nét đúng` : null,
    tone: GRADE_TONE[grade],
  }
}

/** What the issue lines say, as one sentence each (screen readers hear them after the headline). */
export function resultDescription(lines: readonly string[]): string {
  return lines.length > 0 ? lines.map((p) => p.replace(/[.!]$/, '')).join('. ') + '.' : ''
}

/** After a font-glyph reveal (no stroke data, so no stroke review): what to do next. */
const COMPARE_LINE = 'So sánh chữ của bạn với mẫu, rồi tự đánh giá.'

/**
 * What the panel lists under the headline. With stroke data: the stroke issues — plus the scorer's
 * own lines when the score, not the strokes, holds the verdict down, so a lowered verdict never
 * comes without a reason (the panel says "Đúng thứ tự, đúng chiều." only when there is no line at
 * all). Without stroke data: the scorer's lines, or after a reveal what to do next. Lines about
 * strokes something cut short (`cuts`) come last.
 */
export function resultLines(result: ScoreResult, summary: StrokeSummary | null, cuts: readonly string[], revealed: boolean): string[] {
  if (!summary) return [...(revealed ? [COMPARE_LINE] : result.feedback), ...cuts]
  const scoreHolds = result.status === 'scored' && GRADE_RANK[result.grade] < GRADE_RANK[strokeGrade(summary)]
  return [...summary.issues, ...(scoreHolds ? result.feedback : []), ...cuts]
}

/**
 * Strokes that something other than the learner ended — the browser taking the pointer
 * ('cancel', e.g. an edge swipe) or the app ('interrupted', e.g. scoring mid-stroke) — may be cut
 * short. When such a stroke did not come out right, say so, since the cut may be why. Named by the
 * reference stroke it was taken for. A tap is no stroke: nothing to say about it.
 */
export function interruptionLines(ends: readonly (StrokeEnd | undefined)[], check: StrokeCheck | null): string[] {
  const lines: string[] = []
  ends.forEach((end, k) => {
    if (end !== 'cancel' && end !== 'interrupted') return
    const judged = check?.user[k]
    if (judged?.verdict === 'good' || judged?.issue === 'tap') return
    const line = judged?.ref != null ? `Nét ${judged.ref + 1}: bị ngắt giữa chừng` : 'Có nét bị ngắt giữa chừng'
    if (!lines.includes(line)) lines.push(line)
  })
  return lines
}

/** The first `max` lines, and how many more a "+N" expander holds. */
export function previewLines(lines: readonly string[], max = 2): { shown: string[]; more: number } {
  return lines.length <= max ? { shown: [...lines], more: 0 } : { shown: lines.slice(0, max), more: lines.length - max }
}
