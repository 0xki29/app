import type { StrokeCheck, StrokeIssue } from '../strokes/strokeCheck'

/** Learner-facing wording for the stroke-by-stroke check (strokeCheck.ts). */

const ISSUE_TEXT: Record<StrokeIssue, string> = {
  reversed: 'ngược chiều',
  order: 'sai thứ tự',
  misplaced: 'lệch vị trí',
  short: 'hơi ngắn',
  long: 'hơi dài',
  split: 'viết thành 2 nét',
  merged: 'viết liền thành 1 nét',
  unmatched: 'chưa đúng nét',
  extra: 'thừa',
  tap: 'chạm nhầm',
}

export interface StrokeSummary {
  /**
   * The character's strokes by verdict: good + off + wrong + missing = its stroke count. A stroke
   * written out of order, reversed or unrecognisable is wrong; one written in two pieces or joined
   * to the next is off.
   */
  good: number
  off: number
  wrong: number
  missing: number
  /** Learner strokes that are no stroke of the character — not counted above. Taps are ignored. */
  extra: number
  /**
   * Every issue, one line each ("Nét 2: ngược chiều", strokeIssueLines); empty when all is right.
   * The result panel shows the first few and expands to the rest.
   */
  issues: string[]
}

export function summarizeStrokes(check: StrokeCheck): StrokeSummary {
  const count = (v: string) => check.reference.filter((r) => r.verdict === v).length
  return {
    good: count('good'),
    off: count('off'),
    wrong: count('wrong'),
    missing: count('missing'),
    extra: check.user.filter((u) => u.issue === 'extra').length,
    issues: strokeIssueLines(check),
  }
}

/**
 * One line per issue, in the character's stroke order, named by the stroke's standard number:
 * "Nét 2: ngược chiều", "Nét 11: thiếu", runs of missing strokes as "Nét 3–4: thiếu", two strokes
 * joined as "Nét 2–3: viết liền thành 1 nét"; then extra strokes ("Nét thừa", "2 nét thừa").
 */
export function strokeIssueLines(check: StrokeCheck): string[] {
  const lines: string[] = []
  const refs = check.reference
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]
    if (r.verdict === 'good') continue
    // A run: missing strokes in a row, or the two strokes one learner stroke joined.
    let last = i
    if (r.verdict === 'missing') {
      while (last + 1 < refs.length && refs[last + 1].verdict === 'missing') last++
    } else if (r.issue === 'merged') {
      while (last + 1 < refs.length && refs[last + 1].issue === 'merged' && sameStrokes(refs[last + 1].user, r.user)) last++
    }
    const text = r.verdict === 'missing' ? 'thiếu' : r.issue ? ISSUE_TEXT[r.issue] : null
    if (text) lines.push(`Nét ${i + 1}${last > i ? `–${last + 1}` : ''}: ${text}`)
    i = last
  }
  const extra = check.user.filter((u) => u.issue === 'extra').length
  if (extra > 0) lines.push(extra === 1 ? 'Nét thừa' : `${extra} nét thừa`)
  return lines
}

function sameStrokes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
