import { align, alignmentScale, boundsOf, polylineLength, resample } from '../handwriting/scoring/geometry'
import type { ScoringMode, Vec } from '../handwriting/scoring/types'
import type { Ink } from '../handwriting/types'
import { sourceToBox } from './transform'
import type { StrokeData } from './types'

/**
 * Stroke-by-stroke check of an attempt against stroke data, for the review after "Chấm điểm":
 * which of the learner's strokes were right, a bit off, or wrong — and which reference strokes are
 * missing. A diagnostic next to the score, not part of it (the total is unchanged).
 *
 * Strokes are paired by writing order: the learner's k-th stroke is judged as the reference's k-th.
 * It counts pen lifts, like the stroke-number badges, so a stroke written in two pieces shifts the
 * pairing of everything after it. Recall first aligns the whole attempt's bounding box with the
 * reference (as the scorer does), so a well-formed character written smaller or off-center is not
 * marked wrong stroke by stroke; Trace judges in place.
 */

/** good — right stroke, right place, right way · off — the right stroke, but misplaced or too
 *  short/long · wrong — reversed, out of order, not a reference stroke, or extra. */
export type StrokeVerdict = 'good' | 'off' | 'wrong'

export type StrokeIssue = 'reversed' | 'order' | 'misplaced' | 'short' | 'long' | 'unmatched' | 'extra'

export interface UserStrokeCheck {
  verdict: StrokeVerdict
  issue: StrokeIssue | null
  /** For 'order': the reference stroke (index) this stroke matches instead. */
  looksLike: number | null
}

export interface StrokeCheck {
  /** One entry per learner stroke, in writing order. */
  user: UserStrokeCheck[]
  /** Reference strokes (indices) the attempt never reached: it stopped short. */
  missing: number[]
  /**
   * Recall: where the reference lands on the learner's ink, the inverse of the alignment used to
   * judge — box point p shows at p·scale + (x, y). Drawing the reference there makes what the
   * learner sees agree with the verdicts. Null when judged in place (Trace).
   */
  referenceToInk: { scale: number; x: number; y: number } | null
}

export interface StrokeCheckConfig {
  /**
   * Mean distance (box units), both ways between a learner stroke and a reference centerline, up to
   * which the stroke is right: about half a stroke's width in Trace, so tracing anywhere inside the
   * faint reference counts.
   */
  good: number
  /** Up to this distance it is still recognisably that stroke, just misplaced. */
  off: number
  /** Align the attempt's bounding box to the reference's first (Recall). */
  align: boolean
}

export const STROKE_CHECK: Readonly<Record<ScoringMode, StrokeCheckConfig>> = {
  trace: { good: 0.035, off: 0.075, align: false },
  recall: { good: 0.045, off: 0.09, align: true },
}

/** Resampling step for the comparison, box units. */
const SPACING = 0.008
/** Below this length (box units) a reference stroke is a dot: its direction is not judged. */
const MIN_DIRECTION_LENGTH = 0.06
/** Reversed: the learner's stroke runs backwards along the reference by at least this share of it. */
const REVERSED_SHARE = 0.3
/** An 'order' match must fit the other stroke clearly better than its own. */
const ORDER_MARGIN = 0.7
/** Length ratio (learner / reference) outside which a misplaced stroke is called short or long. */
const SHORT_RATIO = 0.7
const LONG_RATIO = 1.4

interface Fit {
  /** Mean distance from the learner's stroke to the reference centerline. */
  toRef: number
  /** Mean distance from the reference centerline to the learner's stroke. */
  toUser: number
  reversed: boolean
  lengthRatio: number
}

export function checkStrokes(ink: Ink, data: StrokeData, mode: ScoringMode): StrokeCheck {
  const cfg = STROKE_CHECK[mode]
  const refs = data.medians.map((m) =>
    resample(
      m.map(([x, y]) => sourceToBox(x, y)),
      SPACING,
    ),
  )
  const strokes = ink.strokes.filter((s) => s.points.length > 0)

  let users = strokes.map((s) => s.points as readonly Vec[])
  let referenceToInk: StrokeCheck['referenceToInk'] = null
  const paired = Math.min(users.length, refs.length)
  if (cfg.align && paired > 0) {
    // Only the paired strokes set the alignment: a missing or extra stroke must not resize the rest.
    const from = boundsOf(users.slice(0, paired).flat())
    const to = boundsOf(refs.slice(0, paired).flat())
    const scale = alignmentScale(from, to)
    users = users.map((pts) => align(pts, from, to, scale))
    // align() maps ink center → reference center at `scale`; this is the way back.
    const back = 1 / scale
    referenceToInk = {
      scale: back,
      x: (from.minX + from.maxX) / 2 - ((to.minX + to.maxX) / 2) * back,
      y: (from.minY + from.maxY) / 2 - ((to.minY + to.maxY) / 2) * back,
    }
  }
  const samples = users.map((pts) => resample(pts, SPACING))

  const user = samples.map((u, k): UserStrokeCheck => {
    if (k >= refs.length) return { verdict: 'wrong', issue: 'extra', looksLike: null }
    const own = fit(u, refs[k])
    const ownDist = Math.max(own.toRef, own.toUser)
    if (ownDist <= cfg.good) {
      return own.reversed ? { verdict: 'wrong', issue: 'reversed', looksLike: null } : { verdict: 'good', issue: null, looksLike: null }
    }
    // Written well, but it is another stroke of the character: out of order.
    let other = -1
    let otherDist = Infinity
    refs.forEach((r, j) => {
      if (j === k) return
      const f = fit(u, r)
      const d = Math.max(f.toRef, f.toUser)
      if (d < otherDist) {
        otherDist = d
        other = j
      }
    })
    if (other >= 0 && otherDist <= cfg.good && otherDist < ORDER_MARGIN * ownDist) {
      return { verdict: 'wrong', issue: 'order', looksLike: other }
    }
    // On the reference stroke, but only part of it.
    if (own.toRef <= cfg.good && !own.reversed && own.lengthRatio < SHORT_RATIO) {
      return { verdict: 'off', issue: 'short', looksLike: null }
    }
    if (ownDist <= cfg.off) {
      if (own.reversed) return { verdict: 'wrong', issue: 'reversed', looksLike: null }
      const issue = own.lengthRatio < SHORT_RATIO ? 'short' : own.lengthRatio > LONG_RATIO ? 'long' : 'misplaced'
      return { verdict: 'off', issue, looksLike: null }
    }
    return { verdict: 'wrong', issue: 'unmatched', looksLike: null }
  })

  const missing: number[] = []
  for (let k = samples.length; k < refs.length; k++) missing.push(k)
  return { user, missing, referenceToInk }
}

function fit(user: readonly Vec[], ref: readonly Vec[]): Fit {
  const refLength = polylineLength(ref)
  let reversed = false
  if (refLength >= MIN_DIRECTION_LENGTH && user.length > 1) {
    const s0 = projectShare(user[0], ref, refLength)
    const s1 = projectShare(user[user.length - 1], ref, refLength)
    reversed = s0 - s1 >= REVERSED_SHARE
  }
  return {
    toRef: meanDistance(user, ref),
    toUser: meanDistance(ref, user),
    reversed,
    lengthRatio: refLength > 0 ? polylineLength(user) / refLength : 1,
  }
}

/** Mean distance from the points of `a` to the polyline `b`. */
function meanDistance(a: readonly Vec[], b: readonly Vec[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  let sum = 0
  for (const p of a) sum += nearestOnPolyline(p, b).distance
  return sum / a.length
}

/** Where along `line` (0 = start, 1 = end, by arc length) the point nearest to `p` lies. */
function projectShare(p: Vec, line: readonly Vec[], length: number): number {
  return length > 0 ? nearestOnPolyline(p, line).along / length : 0
}

function nearestOnPolyline(p: Vec, line: readonly Vec[]): { distance: number; along: number } {
  if (line.length === 1) return { distance: Math.hypot(p.x - line[0].x, p.y - line[0].y), along: 0 }
  let best = Infinity
  let bestAlong = 0
  let walked = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    const seg = Math.sqrt(len2)
    if (d < best) {
      best = d
      bestAlong = walked + t * seg
    }
    walked += seg
  }
  return { distance: best, along: bestAlong }
}
