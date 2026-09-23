import type { SourcePoint } from './types'

/**
 * Timing of the stroke-order animation, as pure functions of a time `t` in ms. One loop:
 *
 *   [lead: empty box] [stroke 1] [gap] [stroke 2] … [gap] [stroke N] [hold: whole character] → lead …
 *
 * The animator only advances `t`; everything the learner sees (which strokes are drawn, how far the
 * active one is) is derived from it here, so stepping, pace changes and looping are testable without
 * a DOM.
 */

export type Pace = 'slow' | 'normal'

export interface PaceConfig {
  /** Brush speed along a stroke's median, in dataset units per second (the em square is 1024). */
  readonly unitsPerSecond: number
  /** Short strokes (dots) still get time to be seen. */
  readonly minStrokeMs: number
  /** Long strokes do not drag. */
  readonly maxStrokeMs: number
  /** Pause between two strokes: time to notice where the next one starts. */
  readonly strokeGapMs: number
  /** Whole character held at the end of each loop. */
  readonly holdMs: number
  /** Empty box at the start of each loop, so the first stroke is not missed. */
  readonly leadMs: number
}

export const PACE: Readonly<Record<Pace, PaceConfig>> = {
  slow: { unitsPerSecond: 450, minStrokeMs: 600, maxStrokeMs: 2200, strokeGapMs: 550, holdMs: 2200, leadMs: 600 },
  normal: { unitsPerSecond: 1000, minStrokeMs: 300, maxStrokeMs: 1100, strokeGapMs: 250, holdMs: 1400, leadMs: 400 },
}

export interface StrokeSpan {
  readonly start: number
  readonly end: number
}

export interface Timeline {
  /** Stroke i is being drawn during [start, end). */
  readonly strokes: readonly StrokeSpan[]
  /** Length of one loop; `t` is always taken modulo this. */
  readonly total: number
}

export type FramePhase = 'lead' | 'stroke' | 'gap' | 'hold'

/** What the box shows at one instant. */
export interface Frame {
  /** Strokes [0, completed) are fully drawn. */
  readonly completed: number
  /** Index of the stroke being drawn, or -1. */
  readonly active: number
  /** 0..1 along the active stroke; 0 when there is none. */
  readonly progress: number
  readonly phase: FramePhase
}

const LEAD_FRAME: Frame = { completed: 0, active: -1, progress: 0, phase: 'lead' }

/** Length of a polyline (a median), in its own units. */
export function polylineLength(points: readonly SourcePoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return length
}

/** Constant brush speed, clamped so dots stay visible and long strokes do not drag. */
export function strokeDurationMs(length: number, pace: PaceConfig): number {
  const ms = Number.isFinite(length) && length > 0 ? (length / pace.unitsPerSecond) * 1000 : 0
  return Math.min(pace.maxStrokeMs, Math.max(pace.minStrokeMs, ms))
}

export function buildTimeline(medianLengths: readonly number[], pace: PaceConfig): Timeline {
  const strokes: StrokeSpan[] = []
  let t = pace.leadMs
  medianLengths.forEach((length, i) => {
    if (i > 0) t += pace.strokeGapMs
    const start = t
    t += strokeDurationMs(length, pace)
    strokes.push({ start, end: t })
  })
  return { strokes, total: t + pace.holdMs }
}

/** `t` folded into [0, total). Non-finite times and empty timelines map to 0. */
export function wrapTime(timeline: Timeline, t: number): number {
  const total = timeline.total
  if (!(total > 0) || !Number.isFinite(t)) return 0
  const r = t % total
  const wrapped = r < 0 ? r + total : r
  // A tiny negative remainder can round up to `total` itself.
  return wrapped >= total ? 0 : wrapped
}

/**
 * The frame at time `t` (wrapped into the loop). Boundaries: a stroke is active on [start, end); at
 * exactly `end` it counts as completed, so the step targets below are stable resting positions.
 */
export function frameAt(timeline: Timeline, t: number): Frame {
  const strokes = timeline.strokes
  const n = strokes.length
  if (n === 0) return LEAD_FRAME
  const time = wrapTime(timeline, t)
  if (time < strokes[0].start) return LEAD_FRAME
  // Last stroke that has started.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (strokes[mid].start <= time) lo = mid
    else hi = mid - 1
  }
  const span = strokes[lo]
  if (time < span.end) {
    return { completed: lo, active: lo, progress: (time - span.start) / (span.end - span.start), phase: 'stroke' }
  }
  return { completed: lo + 1, active: -1, progress: 0, phase: lo + 1 === n ? 'hold' : 'gap' }
}

/** The 1-based stroke shown as "Nét k/N": the one being drawn, else the last completed; 0 = empty box. */
export function strokeNumber(frame: Frame): number {
  return frame.active >= 0 ? frame.active + 1 : frame.completed
}

/** Resting position with the first `count` strokes drawn: the end of stroke `count`, or 0 (empty box). */
function stopAfter(timeline: Timeline, count: number): number {
  return count <= 0 ? 0 : timeline.strokes[Math.min(count, timeline.strokes.length) - 1].end
}

/**
 * "Next stroke": finish the stroke being drawn, or draw the next one whole. From the whole character
 * it stays there (no wrap-around to an empty box).
 */
export function nextStop(timeline: Timeline, t: number): number {
  const n = timeline.strokes.length
  if (n === 0) return 0
  const frame = frameAt(timeline, t)
  return stopAfter(timeline, frame.active >= 0 ? frame.active + 1 : Math.min(frame.completed + 1, n))
}

/**
 * "Previous stroke": remove the stroke shown in the indicator — the one being drawn (it restarts from
 * nothing) or else the last completed one — so the indicator always goes down by one. Stops at 0.
 */
export function prevStop(timeline: Timeline, t: number): number {
  if (timeline.strokes.length === 0) return 0
  return stopAfter(timeline, strokeNumber(frameAt(timeline, t)) - 1)
}

/** Loop boundaries: lead | stroke 0 | gap | stroke 1 | … | stroke N−1 | hold. */
function boundaries(timeline: Timeline): number[] {
  const b = [0]
  for (const s of timeline.strokes) b.push(s.start, s.end)
  b.push(timeline.total)
  return b
}

/**
 * The time in `to` that shows the same thing as `t` in `from` (same phase, same stroke, same fraction
 * of it) — so a pace change mid-play neither jumps nor restarts. Both timelines must describe the same
 * strokes; otherwise it restarts at 0.
 */
export function retime(from: Timeline, to: Timeline, t: number): number {
  if (from.strokes.length !== to.strokes.length) return 0
  const a = boundaries(from)
  const b = boundaries(to)
  const time = wrapTime(from, t)
  for (let k = 0; k < a.length - 1; k++) {
    if (time >= a[k + 1]) continue
    const fraction = (time - a[k]) / (a[k + 1] - a[k])
    return wrapTime(to, b[k] + fraction * (b[k + 1] - b[k]))
  }
  return 0
}
