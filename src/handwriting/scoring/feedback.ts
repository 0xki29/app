import { GRADE_THRESHOLDS, WEAK_COMPONENT } from './config'
import type { Grade, ScoreBreakdown, ScoreDiagnostics } from './types'

export function gradeFor(total: number): Grade {
  for (const { grade, min } of GRADE_THRESHOLDS) if (total >= min) return grade
  return 'needs-work'
}

const BASE: Record<Grade, string> = {
  excellent: 'Rất tốt!',
  good: 'Khá tốt, hình dáng đã rất gần mẫu.',
  fair: 'Khá ổn, thử chú ý hơn đến vị trí và độ dài nét.',
  'needs-work': 'Thử viết chậm hơn và bám sát hình dáng mẫu.',
}

/** One base line per grade + at most one specific hint, so the panel stays short. */
export function feedbackFor(grade: Grade, b: ScoreBreakdown, d: ScoreDiagnostics): string[] {
  const lines = [BASE[grade]]
  if (grade === 'excellent') return lines

  const weak = (v: number | null) => v !== null && v < WEAK_COMPONENT
  if (b.strokeCount !== null && b.strokeCount < 100 && d.referenceStrokes !== null) {
    lines.push(`Bạn viết ${d.userStrokes} nét, chữ này có ${d.referenceStrokes} nét.`)
  } else if (weak(b.position) && (b.length === null || b.position! <= b.length)) {
    lines.push('Một vài nét đang lệch khỏi vị trí mẫu.')
  } else if (weak(b.length)) {
    lines.push('Độ dài các nét còn chênh lệch.')
  } else if (b.shape !== null && b.shape >= 85) {
    lines.push('Hình dáng tổng thể đã khá gần mẫu.')
  }
  return lines
}
