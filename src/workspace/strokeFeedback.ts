import type { StrokeCheck, StrokeIssue } from '../strokes/strokeCheck'

/** Learner-facing wording for the stroke-by-stroke check (strokeCheck.ts). */

const ISSUE_TEXT: Record<StrokeIssue, string> = {
  reversed: 'ngược chiều',
  order: 'sai thứ tự',
  misplaced: 'lệch vị trí',
  short: 'hơi ngắn',
  long: 'hơi dài',
  unmatched: 'chưa đúng nét',
  extra: 'thừa',
}

/** How many issues are spelled out before "+ N lỗi khác". */
const MAX_ISSUES = 3

export interface StrokeSummary {
  good: number
  off: number
  wrong: number
  missing: number
  /** Short lines like "Nét 2: ngược chiều", in stroke order; empty when everything is right. */
  issues: string[]
}

export function summarizeStrokes(check: StrokeCheck): StrokeSummary {
  const count = (v: string) => check.user.filter((u) => u.verdict === v).length
  const all: string[] = []
  check.user.forEach((u, i) => {
    if (u.verdict === 'good' || !u.issue) return
    const text =
      u.issue === 'order' && u.looksLike !== null ? `${ISSUE_TEXT.order} (là nét ${u.looksLike + 1})` : ISSUE_TEXT[u.issue]
    all.push(`Nét ${i + 1}: ${text}`)
  })
  for (const [from, to] of runs(check.missing)) {
    all.push(`Nét ${from + 1}${to > from ? `–${to + 1}` : ''}: thiếu`)
  }
  const issues = all.length > MAX_ISSUES ? [...all.slice(0, MAX_ISSUES), `+ ${all.length - MAX_ISSUES} lỗi khác`] : all
  return { good: count('good'), off: count('off'), wrong: count('wrong'), missing: check.missing.length, issues }
}

/** Consecutive runs in a sorted index list: [4, 5, 7] → [[4, 5], [7, 7]]. */
function runs(indices: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (const i of indices) {
    const last = out[out.length - 1]
    if (last && i === last[1] + 1) last[1] = i
    else out.push([i, i])
  }
  return out
}
