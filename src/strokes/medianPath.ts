import { polylineLength } from './timeline'
import type { SourcePoint } from './types'

/**
 * Animated strokes are drawn the hanzi-writer way: a wide, round-capped line along the stroke's
 * median, clipped by the stroke's outline and revealed with stroke-dashoffset. The line must be wide
 * enough to cover the outline's widest part everywhere, or unpainted slivers remain.
 *
 * Measured over the test fixtures (medianPath.test.ts): no outline point is farther than 84 units from
 * its median (学 stroke 5; 謝 stroke 16 ≈ 83). 200 (radius 100) leaves a margin for characters added
 * later, and is the width hanzi-writer uses over the whole Make Me a Hanzi set. Wider would only make
 * the reveal run further ahead of the brush around hooks and bends.
 */
export const MEDIAN_STROKE_WIDTH = 200

export interface MedianPath {
  /** SVG path data in dataset coordinates. */
  readonly d: string
  /** Length of `d`: the dash length that reveals the whole stroke. */
  readonly length: number
  /**
   * Length of the start extension (the line's radius, or 0 for a degenerate median). The round cap
   * already reaches this far past the dash end, so a sweep that should move the visible front along
   * the median itself runs the dash end over [0, length − lead] (see StrokeAnimator).
   */
  readonly lead: number
}

/**
 * The median, extended backwards at its start by the line's radius so the round cap at the dash
 * start covers the rounded head of the outline, which can reach behind the median's first point.
 */
export function medianPath(points: readonly SourcePoint[], width = MEDIAN_STROKE_WIDTH): MedianPath {
  const extended = extendStart(points, width / 2)
  const rounded = extended.map(([x, y]) => [round1(x), round1(y)] as const)
  const d = rounded.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const length = polylineLength(rounded)
  const lead = extended.length > points.length ? Math.min(length, polylineLength(rounded.slice(0, 2))) : 0
  return { d, length, lead }
}

/** Prepends a point `by` units before the first point, continuing the first non-degenerate segment. */
export function extendStart(points: readonly SourcePoint[], by: number): SourcePoint[] {
  const first = points[0]
  if (!first || by <= 0) return [...points]
  for (let i = 1; i < points.length; i++) {
    const dx = first[0] - points[i][0]
    const dy = first[1] - points[i][1]
    const length = Math.hypot(dx, dy)
    if (length > 0) return [[first[0] + (dx / length) * by, first[1] + (dy / length) * by], ...points]
  }
  return [...points]
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
