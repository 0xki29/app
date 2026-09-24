import { isTap as isTapContact } from '../handwriting/inputPolicy'
import { boundsOf, resample, type Bounds } from '../handwriting/scoring/geometry'
import type { ScoringMode, Vec } from '../handwriting/scoring/types'
import type { Ink, Stroke } from '../handwriting/types'
import { sourceToBox } from './transform'
import type { StrokeData } from './types'

/**
 * Stroke-by-stroke check of an attempt against stroke data, for the review after "Chấm điểm":
 * which reference strokes the learner got right, a bit off, or wrong, which are missing — and what
 * each of the learner's strokes was taken for. A diagnostic next to the score, not part of it.
 *
 * The learner's strokes are aligned with the reference's in writing order, like an edit distance
 * (dynamic programming): a learner stroke matches a reference stroke or is extra, a reference
 * stroke is matched or missing, two consecutive learner strokes may make one reference stroke
 * together (written in two pieces), and one learner stroke may cover two consecutive reference
 * strokes (joined). So a forgotten stroke is named as missing instead of shifting the pairing of
 * everything after it. Leftover strokes on both sides that fit each other were written out of order
 * (as are strokes the alignment took for a neighbour they do not look like). A stroke is judged by
 * its mean distance to the reference both ways, how far any part of it strays, whether it reaches
 * both ends, its direction, and — when not right — whether it still runs along the reference. Taps
 * are no strokes and are ignored.
 *
 * Recall first aligns the attempt with the reference (from several starts — in place, box onto box,
 * part of the character — then refined on the strokes that came out right), so a well-formed
 * character written smaller, off-center or only in part is not marked wrong stroke by stroke; Trace
 * judges in place.
 */

/** good — right stroke, right place, right way · off — the right stroke, but misplaced, too
 *  short/long, or in the wrong number of pieces · wrong — reversed, out of order, not recognisably
 *  that stroke, or extra. */
export type StrokeVerdict = 'good' | 'off' | 'wrong'

/**
 * What is wrong with a stroke.
 * off: misplaced (also: right on average but with a detour) · short · long (also: a tail or hook
 * added) · split (one reference stroke written in two pieces) · merged (two consecutive reference
 * strokes written as one).
 * wrong: reversed · order (a stroke of the character, written out of order) · unmatched (where a
 * stroke belongs, but not recognisably it) · extra (learner stroke only: no stroke of the character).
 * tap (learner stroke only): a touch too short to be a stroke; ignored — the input normally drops
 * these before they reach the ink.
 */
export type StrokeIssue =
  | 'reversed'
  | 'order'
  | 'misplaced'
  | 'short'
  | 'long'
  | 'split'
  | 'merged'
  | 'unmatched'
  | 'extra'
  | 'tap'

/** One per learner stroke (engine stroke order), for coloring the learner's ink. */
export interface UserStrokeCheck {
  verdict: StrokeVerdict
  issue: StrokeIssue | null
  /** Reference stroke it was matched to (the first of the two for 'merged'); null for extra/tap. */
  ref: number | null
}

/** One per reference stroke, for the stroke-number badges and the issue list. */
export interface RefStrokeCheck {
  verdict: StrokeVerdict | 'missing'
  issue: StrokeIssue | null
  /** Learner strokes matched to it (two for a split), in writing order; empty when missing. */
  user: number[]
}

export interface StrokeCheck {
  /** One entry per stroke of the ink, in writing order. */
  user: UserStrokeCheck[]
  /** One entry per reference stroke, in standard order. */
  reference: RefStrokeCheck[]
  /** Reference strokes (indices) nothing was written for: `reference[i].verdict === 'missing'`. */
  missing: number[]
  /**
   * Recall: where the reference lands on the learner's ink, the inverse of the alignment used to
   * judge — box point p shows at p·scale + (x, y). Drawing the reference there makes what the
   * learner sees agree with the verdicts. Null when judged in place (Trace, or a Recall attempt with
   * too few strokes to align on).
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
  /** Up to this distance, running along it, it is still recognisably that stroke, just misplaced. */
  off: number
  /** Align the attempt with the reference first (Recall). */
  align: boolean
}

export const STROKE_CHECK: Readonly<Record<ScoringMode, StrokeCheckConfig>> = {
  trace: { good: 0.035, off: 0.075, align: false },
  recall: { good: 0.045, off: 0.09, align: true },
}

/** Resampling step for the comparison, box units. */
const SPACING = 0.01
/** Learner strokes are measured to within this (box units) of their exact polyline: ~0.6 px in a 300 px box. */
const SIMPLIFY = 0.002
/** Below this length (box units) a reference stroke is a dot: its direction is not judged. */
const MIN_DIRECTION_LENGTH = 0.06
/** Reversed: the learner's stroke runs backwards along the reference by at least this share of it. */
const REVERSED_SHARE = 0.3
/** A stroke not written right runs along its reference if this share of it is within ALONG_DEG of it. */
const ALONG_SHARE = 0.7
const ALONG_DEG = 35
/** Half the length (box units) a direction is taken over. */
const ALONG_REACH = 0.03
/**
 * A good stroke reaches both ends of its reference, within END_SHARE of the reference's length — at
 * least END_FLOOR box, under half the width of the stroke as drawn, where a shortfall does not show —
 * or it spans SPAN_OK of the reference's length (a hook left off, or the whole stroke a little ahead
 * of or behind its place).
 */
const END_SHARE = 0.15
const END_FLOOR = 0.03
const SPAN_OK = 0.8
/** Reference strokes shorter than this (box units) are dots: see reachesEnds. */
const DOT_LENGTH = 0.12
const DOT_SPAN = 0.4
const DOT_MIN = 0.02
/**
 * A good stroke also stays within STRAY × good of the reference, all but STRAY_SLACK (box units) of
 * it: a hook or tail added barely moves a mean distance.
 */
const STRAY = 1.5
const STRAY_SLACK = 0.02
/** Off strokes spanning less than this share of their reference are short, more than LONG_SPAN long. */
const SHORT_SPAN = 0.7
const LONG_SPAN = 1.4
// Alignment costs, in units where matching a stroke at the 'off' distance costs MATCH_AT_OFF. Every
// recognisable match (up to REACH × off) costs less than a missing + an extra stroke, so strokes are
// matched in order whenever they can be; a swap costs two poor matches, more than one missing + one
// extra, which is how it shows up as 'order'.
const MISSING_COST = 0.5
const EXTRA_COST = 0.5
const MATCH_AT_OFF = 0.9
const MATCH_MAX = 0.99
const SPLIT_COST = 0.25
const MERGE_COST = 0.25
/** A stroke joining two reference strokes is at least this share of their length together, the move from one to the other included. */
const MERGE_LENGTH = 0.75
/** Beyond REACH × off a learner stroke is no attempt at that reference stroke at all. */
const REACH = 2

// Recall alignment (learner box → reference box).
const MIN_SCALE = 0.6
const MAX_SCALE = 1.6
/** Ink whose larger side is below this (box units), or fewer strokes than this, is too little to align on. */
const TINY_INK = 0.1
const MIN_ALIGN_STROKES = 3
/** Correspondences closer together than this (RMS radius, box units) do not pin down a scale. */
const MIN_SPREAD = 0.05
/** Refinements at most, each re-running the matching — unless it moved less than NEARLY (box units). */
const REFINE_PASSES = 2
const NEARLY = 0.005
/** Starts that put the attempt's box within this of each other (box units) are one start. */
const START_APART = 0.02
/** How many of the cheapest starts are refined. */
const REFINED_STARTS = 2
const IDENTITY: Similarity = { scale: 1, x: 0, y: 0 }

interface ReferenceGeometry {
  strokes: Poly[]
  /** strokes[j] and strokes[j + 1] as one polyline, for a learner stroke that joins them. */
  joined: Poly[]
  box: Bounds
}

/** How a learner stroke fits a reference stroke. Mean distances past the reach are only known to be past it. */
interface Fit {
  /** Mean distance from the learner's stroke to the reference centerline. */
  toRef: number
  /** Mean distance from the reference centerline to the learner's stroke. */
  toUser: number
  /**
   * How far short of the reference's start and end the learner's stroke stops: along the
   * reference, or straight from the reference's end to the stroke if that is less (a learner who
   * skips the median's little entry hook still reaches the start).
   */
  startGap: number
  endGap: number
  /** Where along the reference (extended straight past its ends) the learner's stroke starts. */
  at: number
  /**
   * How much of the reference the stroke spans: from where its start to where its end projects,
   * along the reference extended straight past its ends. Wobble does not lengthen it, as it does a
   * path length; a stroke slid along its own direction keeps it.
   */
  span: number
  refLength: number
  /** The two strokes compared, for what is only worth computing for the steps taken. */
  user: Poly
  ref: Poly
}

interface Judgement {
  verdict: StrokeVerdict
  issue: StrokeIssue | null
}

/** One step of the alignment. u, r: learner / reference stroke; a split also takes u + 1, a merge r + 1. */
type Step =
  | { op: 'match' | 'split' | 'merge'; u: number; r: number; fit: Fit; judged: Judgement }
  | { op: 'missing'; r: number }
  | { op: 'extra'; u: number }

interface Alignment {
  steps: Step[]
  /** Total cost: lower is a better account of the attempt. */
  cost: number
  transform: Similarity | null
}

/** How far each kind of step moves back through the learner's and the reference's strokes. */
const STEP_SIZE: Record<Step['op'], readonly [number, number]> = {
  match: [1, 1],
  missing: [0, 1],
  extra: [1, 0],
  split: [2, 1],
  merge: [1, 2],
}

/** Box point p ↦ p·scale + (x, y). */
interface Similarity {
  scale: number
  x: number
  y: number
}

const referenceCache = new WeakMap<StrokeData, ReferenceGeometry>()

function referenceGeometry(data: StrokeData): ReferenceGeometry {
  let geom = referenceCache.get(data)
  if (!geom) {
    // The medians are the paths to measure to, as they are.
    const lines = data.medians.map((m) => m.map(([x, y]) => sourceToBox(x, y)))
    geom = {
      strokes: lines.map((line) => toPoly(line, line)),
      joined: lines.slice(1).map((next, j) => {
        const both = [...lines[j], ...next]
        return toPoly(both, both)
      }),
      box: boundsOf(lines.flat()),
    }
    referenceCache.set(data, geom)
  }
  return geom
}

export function checkStrokes(ink: Ink, data: StrokeData, mode: ScoringMode): StrokeCheck {
  const cfg = STROKE_CHECK[mode]
  const geom = referenceGeometry(data)

  const kept: number[] = [] // ink indices of the strokes judged (taps are not)
  ink.strokes.forEach((s, k) => {
    if (!isTap(s)) kept.push(k)
  })
  const raw = kept.map((k) => ink.strokes[k].points as readonly Vec[])

  const { steps, transform } = cfg.align ? alignRecall(raw, geom, cfg) : alignStrokes(raw, null, geom, cfg)

  const user = ink.strokes.map((): UserStrokeCheck => ({ verdict: 'off', issue: 'tap', ref: null }))
  const reference = geom.strokes.map((): RefStrokeCheck => ({ verdict: 'missing', issue: null, user: [] }))
  const extras: number[] = []
  const missing: number[] = []
  const matched: { u: number; r: number }[] = [] // single matches still recognisable as their stroke
  const loose: { u: number; r: number }[] = [] // single matches not right, but recognisable (off, or reversed)
  const unmatched = new Map<number, number>() // single matches not recognisable as their stroke: u → r
  for (const step of steps) {
    if (step.op === 'missing') missing.push(step.r)
    else if (step.op === 'extra') extras.push(step.u)
    else {
      const { verdict, issue } = structural(step)
      const us = step.op === 'split' ? [step.u, step.u + 1] : [step.u]
      const rs = step.op === 'merge' ? [step.r, step.r + 1] : [step.r]
      for (const u of us) user[kept[u]] = { verdict, issue, ref: step.r }
      for (const r of rs) reference[r] = { verdict, issue, user: us.map((u) => kept[u]) }
      if (step.op === 'match' && verdict !== 'wrong') matched.push({ u: step.u, r: step.r })
      if (step.op === 'match' && verdict !== 'good' && issue !== 'unmatched') loose.push({ u: step.u, r: step.r })
      if (step.op === 'match' && issue === 'unmatched') unmatched.set(step.u, step.r)
    }
  }

  // Left over on both sides and a fit for each other: written out of order. A stroke written out of
  // order may also have been taken for a stroke it does not look like ('unmatched'): matching it
  // there costs less than an extra and a missing stroke. So those strokes are candidates too, and
  // the strokes they were taken for are open to all: if one fits a missing stroke, or the stroke
  // another was taken for, it is that stroke, out of order.
  const fits = new Map<string, number>()
  const lines = new Map<number, Poly>()
  const distance = (u: number, r: number): number => {
    const key = `${u} ${r}`
    let d = fits.get(key)
    if (d === undefined) {
      let line = lines.get(u)
      if (!line) lines.set(u, (line = toPoly(mapPoints(raw[u], transform))))
      const ref = geom.strokes[r]
      d = Infinity
      if (boxGap(line.box, ref.box) <= cfg.off) {
        const f = fit(line, ref, meanDistance(line, ref, cfg.off), meanDistance(ref, line, cfg.off))
        d = Math.max(f.toRef, f.toUser)
      }
      fits.set(key, d)
    }
    return d
  }
  const candidates = [...extras, ...unmatched.keys()]
  const open = new Set([...missing, ...unmatched.values()])
  const moved = new Set<number>()
  for (;;) {
    let pick: { u: number; r: number; d: number } | null = null
    for (const u of candidates) {
      if (moved.has(u)) continue
      for (const r of open) {
        if (unmatched.get(u) === r) continue // not recognisably that stroke, as matched
        const d = distance(u, r)
        if (d <= cfg.off && (!pick || d < pick.d)) pick = { u, r, d }
      }
    }
    if (!pick) break
    const { u, r } = pick
    moved.add(u)
    open.delete(r)
    user[kept[u]] = { verdict: 'wrong', issue: 'order', ref: r }
    reference[r] = { verdict: 'wrong', issue: 'order', user: [kept[u]] }
    // Two neighbours swapped: the one stroke it jumped over is out of order too.
    const crossed = matched.filter((p) => p.u < u !== p.r < r)
    if (crossed.length === 1) {
      const p = crossed[0]
      user[kept[p.u]] = { verdict: 'wrong', issue: 'order', ref: p.r }
      reference[p.r] = { verdict: 'wrong', issue: 'order', user: [kept[p.u]] }
    }
  }
  // Two strokes swapped, one taken for the other's place but not recognisably it, the other close
  // enough to its wrong place to pass as a little off (or reversed): each fits the stroke the other
  // was taken for.
  for (const [u, r] of unmatched) {
    if (moved.has(u) || !open.has(r)) continue
    let other: { u: number; r: number; d: number } | null = null
    for (const p of loose) {
      if (moved.has(p.u)) continue
      const d = Math.max(distance(u, p.r), distance(p.u, r))
      if (d <= cfg.off && (!other || d < other.d)) other = { ...p, d }
    }
    if (!other) continue
    moved.add(u).add(other.u)
    open.delete(r)
    user[kept[u]] = { verdict: 'wrong', issue: 'order', ref: other.r }
    reference[other.r] = { verdict: 'wrong', issue: 'order', user: [kept[u]] }
    user[kept[other.u]] = { verdict: 'wrong', issue: 'order', ref: r }
    reference[r] = { verdict: 'wrong', issue: 'order', user: [kept[other.u]] }
  }
  for (const [u, r] of unmatched) {
    if (moved.has(u)) continue
    // Still taken for the stroke it was matched to — unless that stroke turned out to be written elsewhere.
    if (open.has(r)) open.delete(r)
    else extras.push(u)
  }
  // Strokes left open: nothing written is them.
  for (const r of open) reference[r] = { verdict: 'missing', issue: null, user: [] }
  for (const u of extras) {
    if (!moved.has(u)) user[kept[u]] = { verdict: 'wrong', issue: 'extra', ref: null }
  }

  return {
    user,
    reference,
    missing: reference.flatMap((r, i) => (r.verdict === 'missing' ? [i] : [])),
    referenceToInk: transform ? invert(transform) : null,
  }
}

/**
 * A touch that barely moved and was over quickly (Point.t counts from the first sample): the input
 * policy's own rule. The engine drops taps before they are ink; checked again here so ink from
 * anywhere else (saved or synthetic) cannot shift the alignment.
 */
function isTap(s: Stroke): boolean {
  const pts = s.points
  if (pts.length === 0) return true
  const first = pts[0]
  let reach = 0
  for (const p of pts) reach = Math.max(reach, Math.hypot(p.x - first.x, p.y - first.y))
  return isTapContact(reach, pts[pts.length - 1].t - first.t)
}

/**
 * The order-preserving alignment of the learner's strokes (after `transform`) with the reference's,
 * minimising the total cost of matches, missing and extra strokes, splits and joins.
 */
function alignStrokes(
  raw: readonly (readonly Vec[])[],
  transform: Similarity | null,
  geom: ReferenceGeometry,
  cfg: StrokeCheckConfig,
): Alignment {
  const pts = raw.map((p) => mapPoints(p, transform))
  const users = pts.map((p) => toPoly(p))
  const refs = geom.strokes
  const m = users.length
  const n = refs.length
  const reach = REACH * cfg.off
  const W = n + 1

  // Mean distance from reference stroke j to learner stroke i (capped at reach), on demand.
  const covers = new Float64Array(m * n).fill(-1)
  const coverage = (i: number, j: number): number => {
    const k = i * n + j
    if (covers[k] < 0) covers[k] = meanToBox(refs[j], users[i].box) > reach ? Infinity : meanDistance(refs[j], users[i], reach)
    return covers[k]
  }
  // Single-stroke fits, on demand: null when the learner stroke is out of reach of the reference's.
  const singles: (Fit | null | undefined)[] = new Array(m * n)
  const single = (i: number, j: number): Fit | null => {
    const k = i * n + j
    if (singles[k] === undefined) {
      const u = users[i]
      const r = refs[j]
      // Lower bounds first: the boxes' gap, then each point's distance to the other's box.
      const toRef = boxGap(u.box, r.box) > reach || meanToBox(u, r.box) > reach ? Infinity : meanDistance(u, r, reach)
      singles[k] = toRef > reach ? null : fit(u, r, toRef, coverage(i, j))
    }
    return singles[k]
  }
  const pieces: (Poly | undefined)[] = new Array(m)
  // Learner strokes i and i + 1 as reference stroke j: each piece right on it — not just on
  // average, a stray piece is an extra stroke — and the second continuing where the first stopped,
  // not the same stroke written twice. Only claimed when that is plain.
  const split = (i: number, j: number): Fit | null => {
    const a = single(i, j)
    const b = single(i + 1, j)
    if (!a || !b || a.toRef > cfg.good || b.toRef > cfg.good) return null
    const r = refs[j]
    const firstEnd = nearestAlong(pointOf(users[i].path, users[i].path.count - 1), r.path)
    const secondStart = nearestAlong(pointOf(users[i + 1].path, 0), r.path)
    if (firstEnd - secondStart > Math.max(END_SHARE * r.path.length, END_FLOOR)) return null
    pieces[i] ??= toPoly([...pts[i], ...pts[i + 1]])
    return fit(pieces[i], r, Math.max(a.toRef, b.toRef), meanDistance(r, pieces[i], reach))
  }
  // Learner stroke i as reference strokes j and j + 1: as long as the two joined, each right under
  // it, not just on average, and from the start of the one to the end of the other — a stroke next
  // to a missing one, or between two short ones, is no join. Only claimed when that is plain.
  const merge = (i: number, j: number): Fit | null => {
    if (users[i].path.length < MERGE_LENGTH * geom.joined[j].path.length) return null
    const toUser = Math.max(coverage(i, j), coverage(i, j + 1))
    if (toUser > cfg.good) return null
    const f = fit(users[i], geom.joined[j], meanDistance(users[i], geom.joined[j], reach), toUser)
    return f.toRef <= cfg.good && reachesEnds(f) ? f : null
  }

  const cost = new Float64Array((m + 1) * W).fill(Infinity)
  const step: (Step | null)[] = new Array((m + 1) * W).fill(null)
  cost[0] = 0
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      if (i === 0 && j === 0) continue
      let best = Infinity
      let how: Step | null = null
      const consider = (from: number, extra: number, s: Step) => {
        const c = cost[from] + extra
        if (c < best) {
          best = c
          how = s
        }
      }
      if (i > 0 && j > 0) {
        const f = single(i - 1, j - 1)
        if (f) consider((i - 1) * W + j - 1, matchCost(f, cfg), { op: 'match', u: i - 1, r: j - 1, fit: f, judged: UNJUDGED })
      }
      if (j > 0) consider(i * W + j - 1, MISSING_COST, { op: 'missing', r: j - 1 })
      if (i > 0) consider((i - 1) * W + j, EXTRA_COST, { op: 'extra', u: i - 1 })
      if (i > 1 && j > 0) {
        const f = split(i - 2, j - 1)
        if (f) consider((i - 2) * W + j - 1, SPLIT_COST + matchCost(f, cfg), { op: 'split', u: i - 2, r: j - 1, fit: f, judged: UNJUDGED })
      }
      if (i > 0 && j > 1) {
        const f = merge(i - 1, j - 2)
        if (f) consider((i - 1) * W + j - 2, MERGE_COST + matchCost(f, cfg), { op: 'merge', u: i - 1, r: j - 2, fit: f, judged: UNJUDGED })
      }
      cost[i * W + j] = best
      step[i * W + j] = how
    }
  }

  // Back from the end, judging only the steps taken.
  const out: Step[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    const s = step[i * W + j]!
    out.push('fit' in s ? { ...s, judged: judge(s.fit, cfg) } : s)
    i -= STEP_SIZE[s.op][0]
    j -= STEP_SIZE[s.op][1]
  }
  return { steps: out.reverse(), cost: cost[m * W + n], transform }
}

/** Placeholder until a step is on the chosen path. */
const UNJUDGED: Judgement = { verdict: 'wrong', issue: null }

/** Cost of taking a fit as a match: normalized distance, below MATCH_MAX while recognisable. */
function matchCost(f: Fit, cfg: StrokeCheckConfig): number {
  // On the stroke but covering only part of it: a poor match, not no match.
  const d = f.toRef <= cfg.good ? Math.max(f.toRef, Math.min(f.toUser, cfg.off)) : Math.max(f.toRef, f.toUser)
  if (d <= cfg.off) return (MATCH_AT_OFF * d) / cfg.off
  if (d <= REACH * cfg.off) return MATCH_AT_OFF + ((MATCH_MAX - MATCH_AT_OFF) * (d - cfg.off)) / ((REACH - 1) * cfg.off)
  return Infinity
}

function judge(f: Fit, cfg: StrokeCheckConfig): Judgement {
  const L = f.refLength
  const dist = Math.max(f.toRef, f.toUser)
  const covered = reachesEnds(f)
  const reversed = L >= MIN_DIRECTION_LENGTH && -f.span >= REVERSED_SHARE * L // dots: direction not judged
  if (dist <= cfg.good && covered) {
    if (reversed) return { verdict: 'wrong', issue: 'reversed' }
    // Right on average, but part of it strays off the stroke: a hook or tail added (long), or a
    // detour (misplaced). An average hides it.
    const stray = strayed(f.user, f.ref, STRAY * cfg.good)
    return stray ? { verdict: 'off', issue: stray === 'end' ? 'long' : 'misplaced' } : { verdict: 'good', issue: null }
  }
  // Short, long or misplaced, it must still run along the stroke: a loop or a cross-stroke that
  // merely stays near a bent stroke is not a piece of it.
  const along = alongShare(f.user, f.ref) >= ALONG_SHARE
  const onStroke = along && f.toRef <= cfg.good
  if (!along || (dist > cfg.off && !onStroke)) return { verdict: 'wrong', issue: 'unmatched' }
  if (reversed) return { verdict: 'wrong', issue: 'reversed' }
  // Short or long only if the stroke itself is: moved off a bent or short stroke, the ends it
  // reaches and the span it projects to change while its length does not.
  const len = f.user.path.length
  // On the stroke, but only part of it.
  if (onStroke && !covered) return { verdict: 'off', issue: len < SPAN_OK * L ? 'short' : 'misplaced' }
  const short = f.span < SHORT_SPAN * L && len < SHORT_SPAN * L
  const long = f.span > LONG_SPAN * L && len > LONG_SPAN * L
  return { verdict: 'off', issue: short ? 'short' : long ? 'long' : 'misplaced' }
}

/**
 * Whether more than STRAY_SLACK (box units) of the learner's stroke lies farther than `limit` from
 * the reference: null if not, 'end' if only at its ends (a tail or hook added, an overshoot),
 * 'middle' otherwise.
 */
function strayed(user: Poly, ref: Poly, limit: number): 'end' | 'middle' | null {
  const s = user.samples
  const count = s.length / 2
  const far: boolean[] = []
  let farCount = 0
  for (let i = 0; i < count; i++) {
    const out = squaredDistance(s[i * 2], s[i * 2 + 1], ref.path) > limit * limit
    far.push(out)
    if (out) farCount++
  }
  if (farCount * SPACING <= STRAY_SLACK) return null
  const first = far.indexOf(false)
  const last = far.lastIndexOf(false)
  if (first < 0) return 'middle'
  for (let i = first; i <= last; i++) if (far[i]) return 'middle'
  return 'end'
}

/**
 * The stroke reaches both ends of the reference, or spans most of it (see END_SHARE). A dot or
 * short stroke (under DOT_LENGTH) instead needs a mark over its middle, of at least DOT_SPAN of it
 * and DOT_MIN: its ends are too close together for END_FLOOR to tell a dot from a speck.
 */
function reachesEnds(f: Fit): boolean {
  const L = f.refLength
  if (L < DOT_LENGTH) {
    const lo = Math.min(f.at, f.at + f.span)
    const hi = Math.max(f.at, f.at + f.span)
    return hi - lo >= Math.max(DOT_SPAN * L, DOT_MIN) && lo <= 0.6 * L && hi >= 0.4 * L
  }
  const tol = Math.max(END_SHARE * L, END_FLOOR)
  return (f.startGap <= tol && f.endGap <= tol) || f.span >= SPAN_OK * L
}

/**
 * Share of the learner's samples that run along the reference: within ALONG_DEG, either way
 * (reversal is judged separately), of the reference's direction somewhere within ALONG_REACH of
 * where it is nearest — so a corner or the median's little entry hook, reached a little early or
 * late, does not count against it. The learner's direction is a chord over ALONG_REACH each side,
 * which pointer jitter does not turn. 1 for a dot.
 */
function alongShare(user: Poly, ref: Poly): number {
  const s = user.samples
  const count = s.length / 2
  const { seg, cum, count: points, length: L } = ref.path
  if (count < 3 || L < MIN_DIRECTION_LENGTH) return 1
  const w = Math.round(ALONG_REACH / SPACING)
  const minCos = Math.cos((ALONG_DEG * Math.PI) / 180)
  let along = 0
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(count - 1, i + w)
    const dx = s[b * 2] - s[a * 2]
    const dy = s[b * 2 + 1] - s[a * 2 + 1]
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      along++
      continue
    }
    const at = nearestAlong({ x: s[i * 2], y: s[i * 2 + 1] }, ref.path)
    // Any reference segment overlapping [at − reach, at + reach] will do.
    for (let k = 0; k < points - 1; k++) {
      if (cum[k + 1] < at - ALONG_REACH || cum[k] > at + ALONG_REACH) continue
      const rx = seg[k * 3]
      const ry = seg[k * 3 + 1]
      const rlen = Math.hypot(rx, ry)
      if (rlen > 0 && Math.abs(dx * rx + dy * ry) >= minCos * len * rlen) {
        along++
        break
      }
    }
  }
  return along / count
}

/** A split or join is the issue to report, unless the stroke is plainly wrong anyway. */
function structural(step: Extract<Step, { fit: Fit }>): Judgement {
  if (step.op === 'match' || step.judged.verdict === 'wrong') return step.judged
  return { verdict: 'off', issue: step.op === 'split' ? 'split' : 'merged' }
}

/** The fit of a learner stroke to a reference stroke, given the mean distances both ways. */
function fit(user: Poly, ref: Poly, toRef: number, toUser: number): Fit {
  const L = ref.path.length
  const start = extendedAlong(pointOf(user.path, 0), ref.path)
  const end = extendedAlong(pointOf(user.path, user.path.count - 1), ref.path)
  const reach = (p: Vec) => Math.sqrt(squaredDistance(p.x, p.y, user.path))
  return {
    toRef,
    toUser,
    startGap: Math.min(Math.max(0, start), reach(pointOf(ref.path, 0))),
    endGap: Math.min(Math.max(0, L - end), reach(pointOf(ref.path, ref.path.count - 1))),
    at: start,
    span: end - start,
    refLength: L,
    user,
    ref,
  }
}

// ── Recall alignment ──────────────────────────────────────────────────────

/**
 * Recall: the alignment of the attempt with the reference that accounts for it best. Several
 * starts, since the attempt's bounding box is the reference's only when the whole character was
 * written: in place, box onto box, and — for a character written only in part — the attempt as
 * large as fits in the reference's box against each of its sides, and the attempt as the
 * character's first strokes. The two cheapest starts are then refined on the strokes that came out
 * right; a refinement is kept only if it accounts for the attempt at least as well, and the
 * cheapest result wins.
 */
function alignRecall(raw: readonly (readonly Vec[])[], geom: ReferenceGeometry, cfg: StrokeCheckConfig): Alignment {
  const inPlace = alignStrokes(raw, null, geom, cfg)
  const box = boundsOf(raw.flat())
  const half = Math.max(2, Math.ceil(geom.strokes.length / 2))
  // Too little ink to align on: one or two strokes, or a speck, say nothing about the size.
  if (raw.length < Math.min(MIN_ALIGN_STROKES, half) || !(Math.max(box.maxX - box.minX, box.maxY - box.minY) >= TINY_INK)) return inPlace
  // Fewer strokes than the character: it may be written only in part (the rest forgotten, or not
  // yet written). Otherwise it is the whole character, or more (then only the fewer starts: an
  // attempt with many strokes costs the most to align).
  const partial = raw.length < geom.strokes.length
  // A box says something about the character's once it holds at least half its strokes.
  const starts = raw.length >= half ? boxAlignments(box, geom.box, partial) : []
  const prefix = partial ? prefixAlignment(raw, geom) : null
  if (prefix && ![IDENTITY, ...starts].some((s) => sameStart(s, prefix, box))) starts.push(prefix)
  const tried = [inPlace, ...starts.map((t) => alignStrokes(raw, t, geom, cfg))].sort((a, b) => a.cost - b.cost)
  let best = refined(raw, geom, cfg, tried[0])
  // Every stroke written came out right: no other start can account for it better.
  if (allGood(best)) return best
  for (const start of tried.slice(1, REFINED_STARTS)) {
    const next = refined(raw, geom, cfg, start)
    if (next.cost < best.cost) best = next
  }
  return best
}

/** Aligned again on the strokes that came out right, while that accounts for the attempt at least as well. */
function refined(raw: readonly (readonly Vec[])[], geom: ReferenceGeometry, cfg: StrokeCheckConfig, start: Alignment): Alignment {
  let best = start
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    const next = refineAlignment(raw, geom, best.steps)
    if (!next) break
    if (nearly(next, best.transform)) return { ...best, transform: next }
    const again = alignStrokes(raw, next, geom, cfg)
    if (again.cost > best.cost) break
    best = again
  }
  return best
}

function allGood(a: Alignment): boolean {
  return a.steps.every((s) => s.op === 'missing' || (s.op === 'match' && s.judged.verdict === 'good'))
}

/**
 * Where the attempt may sit on the reference, from the bounding boxes, as starts for the alignment.
 * The whole character: bounding box onto bounding box, centred. Part of it (the rest forgotten, or
 * not yet written): the attempt's box as large as fits in the reference's — along the side it
 * spans — centred, or against either end of the other side.
 */
function boxAlignments(from: Bounds, to: Bounds, partial: boolean): Similarity[] {
  const fw = from.maxX - from.minX
  const fh = from.maxY - from.minY
  const tw = to.maxX - to.minX
  const th = to.maxY - to.minY
  // The attempt's point at (ax, ay) of its box onto the reference box's point at (ax, ay).
  const anchored = (scale: number, ax: number, ay: number): Similarity => ({
    scale,
    x: to.minX + ax * tw - (from.minX + ax * fw) * scale,
    y: to.minY + ay * th - (from.minY + ay * fh) * scale,
  })
  const whole = clampScale(Math.max(tw, th) / Math.max(fw, fh))
  const fits = clampScale(Math.min(fw > 0 ? tw / fw : Infinity, fh > 0 ? th / fh : Infinity))
  const starts: Similarity[] = []
  const seen: Similarity[] = [IDENTITY] // in place is tried anyway
  const anchors = [[whole, 0.5, 0.5], ...(partial ? [[fits, 0.5, 0.5], [fits, 0, 0], [fits, 1, 1], [fits, 0, 1], [fits, 1, 0]] : [])]
  for (const [scale, ax, ay] of anchors) {
    const t = anchored(scale, ax, ay)
    if (seen.some((s) => sameStart(s, t, from))) continue
    seen.push(t)
    starts.push(t)
  }
  return starts
}

/**
 * The attempt as the character's first strokes, as many as were written (the rest not yet
 * written): their samples' centroid onto the reference strokes', scaled by the ratio of their
 * spreads about it. Null when either is too concentrated to give a scale.
 */
function prefixAlignment(raw: readonly (readonly Vec[])[], geom: ReferenceGeometry): Similarity | null {
  const k = Math.min(raw.length, geom.strokes.length)
  const from = raw.flatMap((pts) => resample(pts, SPACING))
  const to: Vec[] = []
  for (let j = 0; j < k; j++) {
    const s = geom.strokes[j].samples
    for (let i = 0; i < s.length; i += 2) to.push({ x: s[i], y: s[i + 1] })
  }
  const a = centroid(from)
  const b = centroid(to)
  const sa = spread(from, a)
  const sb = spread(to, b)
  if (sa < MIN_SPREAD || sb < MIN_SPREAD) return null
  const scale = clampScale(sb / sa)
  return { scale, x: b.x - a.x * scale, y: b.y - a.y * scale }
}

function centroid(pts: readonly Vec[]): Vec {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

/** RMS distance of the points from `c`. */
function spread(pts: readonly Vec[], c: Vec): number {
  let sum = 0
  for (const p of pts) sum += (p.x - c.x) ** 2 + (p.y - c.y) ** 2
  return Math.sqrt(sum / pts.length)
}

/** Two starts that put the attempt's box in nearly the same place (within START_APART, box units). */
function sameStart(a: Similarity, b: Similarity, box: Bounds): boolean {
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      const dx = x * (a.scale - b.scale) + a.x - b.x
      const dy = y * (a.scale - b.scale) + a.y - b.y
      if (Math.hypot(dx, dy) > START_APART) return false
    }
  }
  return true
}

/**
 * Least-squares scale + translation from the strokes that came out right, point for point along
 * each (a missing, extra or misplaced stroke must not move the rest). If fewer than two are right —
 * the alignment it started from is well off, say a stroke that set the bounding box is missing —
 * every stroke matched in order stands in (reversed ones excepted): the matching paired them right
 * even where it judged them off.
 */
function refineAlignment(raw: readonly (readonly Vec[])[], geom: ReferenceGeometry, steps: Step[]): Similarity | null {
  const fitFrom = (counts: (j: Judgement) => boolean): Similarity | null => {
    const from: Vec[] = []
    const to: Vec[] = []
    let strokes = 0
    for (const s of steps) {
      if (s.op !== 'match' || !counts(s.judged)) continue
      const ref = geom.strokes[s.r].path
      const k = Math.max(3, Math.ceil(ref.length / 0.02) + 1)
      const line = pathOf(raw[s.u])
      for (let q = 0; q < k; q++) {
        from.push(pointAt(line, q / (k - 1)))
        to.push(pointAt(ref, q / (k - 1)))
      }
      strokes++
    }
    return strokes >= 2 ? leastSquares(from, to) : null
  }
  return fitFrom((j) => j.verdict === 'good') ?? fitFrom((j) => j.issue !== 'reversed')
}

function leastSquares(from: readonly Vec[], to: readonly Vec[]): Similarity | null {
  const count = from.length
  let fx = 0
  let fy = 0
  let tx = 0
  let ty = 0
  for (let k = 0; k < count; k++) {
    fx += from[k].x
    fy += from[k].y
    tx += to[k].x
    ty += to[k].y
  }
  fx /= count
  fy /= count
  tx /= count
  ty /= count
  let spread = 0
  let cross = 0
  for (let k = 0; k < count; k++) {
    const dx = from[k].x - fx
    const dy = from[k].y - fy
    spread += dx * dx + dy * dy
    cross += dx * (to[k].x - tx) + dy * (to[k].y - ty)
  }
  if (spread / count < MIN_SPREAD * MIN_SPREAD) return null
  const scale = clampScale(cross / spread)
  return { scale, x: tx - fx * scale, y: ty - fy * scale }
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/** No point of the box lands more than NEARLY apart under the two (null: in place). */
function nearly(a: Similarity, b: Similarity | null): boolean {
  const { scale, x, y } = b ?? { scale: 1, x: 0, y: 0 }
  return Math.abs(a.scale - scale) + Math.abs(a.x - x) + Math.abs(a.y - y) < NEARLY
}

function invert(t: Similarity): StrokeCheck['referenceToInk'] {
  return { scale: 1 / t.scale, x: -t.x / t.scale, y: -t.y / t.scale }
}

function mapPoints(pts: readonly Vec[], t: Similarity | null): readonly Vec[] {
  return t ? pts.map((p) => ({ x: p.x * t.scale + t.x, y: p.y * t.scale + t.y })) : pts
}

// ── Polylines ─────────────────────────────────────────────────────────────
// Point-to-polyline distance is the inner loop of the whole check. Each stroke is kept twice: dense
// samples to average over, and the polyline itself — a median as it is, a learner stroke simplified
// — to measure to, with each segment's vector precomputed in flat arrays.

/** A polyline to measure to: points, segments (dx, dy, 1 / squared length or 0), arc length. */
interface Path {
  xy: Float64Array
  count: number
  seg: Float64Array
  cum: Float64Array
  length: number
}

/** A stroke for comparison. */
interface Poly {
  /** Samples every SPACING along it, x0, y0, x1, …: what a mean distance averages over. */
  samples: Float64Array
  /** The stroke itself: what distances are measured to. */
  path: Path
  box: Bounds
}

/** `path`: the polyline to measure to — by default the stroke simplified to within SIMPLIFY. */
function toPoly(points: readonly Vec[], path: readonly Vec[] = simplify(points, SIMPLIFY)): Poly {
  const dense = resample(points, SPACING)
  const samples = new Float64Array(dense.length * 2)
  dense.forEach((p, i) => {
    samples[i * 2] = p.x
    samples[i * 2 + 1] = p.y
  })
  return { samples, path: pathOf(path), box: boundsOf(dense) }
}

function pathOf(pts: readonly Vec[]): Path {
  const count = pts.length
  const xy = new Float64Array(count * 2)
  const seg = new Float64Array(Math.max(0, count - 1) * 3)
  const cum = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    xy[i * 2] = pts[i].x
    xy[i * 2 + 1] = pts[i].y
    if (i === 0) continue
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    const len2 = dx * dx + dy * dy
    seg[(i - 1) * 3] = dx
    seg[(i - 1) * 3 + 1] = dy
    seg[(i - 1) * 3 + 2] = len2 > 0 ? 1 / len2 : 0
    cum[i] = cum[i - 1] + Math.sqrt(len2)
  }
  return { xy, count, seg, cum, length: count > 0 ? cum[count - 1] : 0 }
}

/** Douglas–Peucker: the fewest points of `pts` that stay within `eps` of it. */
function simplify(pts: readonly Vec[], eps: number): Vec[] {
  const n = pts.length
  if (n <= 2) return [...pts]
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const spans: [number, number][] = [[0, n - 1]]
  while (spans.length > 0) {
    const [a, b] = spans.pop()!
    const chord = pathOf([pts[a], pts[b]])
    let worst = -1
    let far = eps * eps
    for (let i = a + 1; i < b; i++) {
      const d2 = squaredDistance(pts[i].x, pts[i].y, chord)
      if (d2 > far) {
        far = d2
        worst = i
      }
    }
    if (worst < 0) continue
    keep[worst] = 1
    spans.push([a, worst], [worst, b])
  }
  return pts.filter((_, i) => keep[i])
}

function pointOf(path: Path, k: number): Vec {
  return { x: path.xy[k * 2], y: path.xy[k * 2 + 1] }
}

/** The point at `share` (0 = start, 1 = end) of the way along the path. */
function pointAt(path: Path, share: number): Vec {
  const { cum, count } = path
  if (count === 1 || path.length === 0) return pointOf(path, 0)
  const at = share * path.length
  let i = 1
  while (i < count - 1 && cum[i] < at) i++
  const seg = cum[i] - cum[i - 1]
  const t = seg > 0 ? Math.min(1, Math.max(0, (at - cum[i - 1]) / seg)) : 0
  const s = (i - 1) * 3
  return { x: path.xy[(i - 1) * 2] + path.seg[s] * t, y: path.xy[(i - 1) * 2 + 1] + path.seg[s + 1] * t }
}

/** Distance between two boxes (0 if they overlap): a lower bound on any point-to-point distance. */
function boxGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
  return Math.hypot(dx, dy)
}

/** Mean distance from the samples of `a` to the stroke `b` — or, once past `cap`, a value past it. */
function meanDistance(a: Poly, b: Poly, cap = Infinity): number {
  const count = a.samples.length / 2
  if (count === 0 || b.path.count === 0) return Infinity
  const stop = cap * count
  let sum = 0
  for (let i = 0; i < count && sum <= stop; i++) sum += Math.sqrt(squaredDistance(a.samples[i * 2], a.samples[i * 2 + 1], b.path))
  return sum / count
}

/** Mean distance from the samples of `a` to the box `b`: a lower bound of the mean distance to what is inside. */
function meanToBox(a: Poly, b: Bounds): number {
  const count = a.samples.length / 2
  let sum = 0
  for (let i = 0; i < count; i++) {
    const x = a.samples[i * 2]
    const y = a.samples[i * 2 + 1]
    sum += Math.hypot(Math.max(0, b.minX - x, x - b.maxX), Math.max(0, b.minY - y, y - b.maxY))
  }
  return sum / count
}

function squaredDistance(px: number, py: number, path: Path): number {
  const { xy, seg, count } = path
  if (count === 1) return (px - xy[0]) ** 2 + (py - xy[1]) ** 2
  let best = Infinity
  for (let k = 0; k < count - 1; k++) {
    const ax = xy[k * 2]
    const ay = xy[k * 2 + 1]
    const dx = seg[k * 3]
    const dy = seg[k * 3 + 1]
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) * seg[k * 3 + 2]))
    const ex = ax + t * dx - px
    const ey = ay + t * dy - py
    const d2 = ex * ex + ey * ey
    if (d2 < best) best = d2
  }
  return best
}

/** Where along `path` (arc length) the point nearest to `p` lies. */
function nearestAlong(p: Vec, path: Path): number {
  const { xy, seg, cum, count } = path
  let best = Infinity
  let along = 0
  for (let k = 0; k < count - 1; k++) {
    const ax = xy[k * 2]
    const ay = xy[k * 2 + 1]
    const dx = seg[k * 3]
    const dy = seg[k * 3 + 1]
    const t = Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) * seg[k * 3 + 2]))
    const ex = ax + t * dx - p.x
    const ey = ay + t * dy - p.y
    const d2 = ex * ex + ey * ey
    if (d2 < best) {
      best = d2
      along = cum[k] + t * (cum[k + 1] - cum[k])
    }
  }
  return along
}

/** Like nearestAlong, but past an end of `path` it keeps counting along the end's direction. */
function extendedAlong(p: Vec, path: Path): number {
  const k = path.count - 1
  if (k < 1) return 0
  const along = nearestAlong(p, path)
  const { xy, seg } = path
  // Signed distance of p past point `at`, along segment `s` (sign −1: backwards, off the start).
  const beyond = (at: number, s: number, sign: number) => {
    const dx = seg[s * 3]
    const dy = seg[s * 3 + 1]
    const len = Math.hypot(dx, dy)
    return len > 0 ? (sign * ((p.x - xy[at * 2]) * dx + (p.y - xy[at * 2 + 1]) * dy)) / len : 0
  }
  // (1e-9: the arc length summed segment by segment may miss the end by a rounding error.)
  if (along <= 1e-9) return Math.min(0, -beyond(0, 0, -1))
  if (along >= path.length - 1e-9) return path.length + Math.max(0, beyond(k, k - 1, 1))
  return along
}
