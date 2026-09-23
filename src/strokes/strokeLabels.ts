import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import { distanceAt, distanceTransform } from '../handwriting/scoring/geometry'
import { rasterizeOutlines } from './rasterize'
import { SOURCE_EM, SOURCE_TOP, sourceToBox } from './transform'
import type { SourcePoint, StrokeData } from './types'

/**
 * Where the stroke-number badges go in Trace (Tô theo): one per stroke, just before the point where
 * the brush lands, off the ink where possible, never on another badge. Pure and deterministic, in
 * dataset coordinates (see transform.ts); the view maps the centers to the box.
 *
 * Each stroke's candidates sit on rings around its start point. A candidate is rejected if it leaves
 * the box or touches a badge already placed (strokes are placed in writing order); the rest are
 * ranked by cost: distance from the start, turning away from "behind the start" (opposite the
 * writing direction, so the badge also hints where the stroke comes from), sitting on a stroke of the
 * reference, and sitting closer to another stroke's start than to its own.
 */

/** Badge radius in dataset units: ≈ 5.4% of the box across (≈ 20 px on a 360 px box). */
export const LABEL_RADIUS = 34

export interface StrokeLabel {
  /** Badge center, dataset coordinates. */
  x: number
  y: number
}

/** Free space wanted between a badge and the reference's ink. */
const INK_GAP = 8
/** Minimum space between two badges. */
const LABEL_GAP = 4
const RING_STEP = 18
const RING_COUNT = 9
const ANGLE_STEPS = 24

// Cost weights, in dataset units per unit of the penalized quantity.
const TURN_COST = 45 // per radian away from "behind the start"
const INK_COST = 6 // per unit the badge (plus INK_GAP) overlaps the reference's ink
const AMBIGUITY_COST = 3 // per unit another stroke's start is closer than the own start
const AMBIGUITY_FLAT = 40

/** The box in dataset coordinates (transform.ts places the em square at REFERENCE_FONT_SCALE, centered). */
const BOX_UNITS = SOURCE_EM / REFERENCE_FONT_SCALE
const BOX_MIN_X = -(BOX_UNITS - SOURCE_EM) / 2
const BOX_MAX_Y = SOURCE_TOP + (BOX_UNITS - SOURCE_EM) / 2
/** Keep badges a little inside the box edge. */
const EDGE_MARGIN = 10

const CLEARANCE_GRID = 128

const cache = new WeakMap<StrokeData, readonly StrokeLabel[]>()

/** Badge centers for every stroke, in stroke order. Computed once per data object. */
export function strokeLabels(data: StrokeData, radius = LABEL_RADIUS): readonly StrokeLabel[] {
  const cached = radius === LABEL_RADIUS ? cache.get(data) : undefined
  if (cached) return cached
  const labels = placeLabels(data, radius)
  if (radius === LABEL_RADIUS) cache.set(data, labels)
  return labels
}

function placeLabels(data: StrokeData, r: number): StrokeLabel[] {
  // Distance to the reference's ink, from the scorer's own raster of the outlines (a cell is ≈ 10
  // dataset units): exact enough for a preference, and cheap enough to ask for every candidate.
  const mask = rasterizeOutlines(data, CLEARANCE_GRID)
  const dt = distanceTransform(mask, CLEARANCE_GRID)
  const starts = data.medians.map((m) => m[0])
  const placed: StrokeLabel[] = []

  const minX = BOX_MIN_X + r + EDGE_MARGIN
  const maxX = BOX_MIN_X + BOX_UNITS - r - EDGE_MARGIN
  const maxY = BOX_MAX_Y - r - EDGE_MARGIN
  const minY = BOX_MAX_Y - BOX_UNITS + r + EDGE_MARGIN

  data.medians.forEach((median, i) => {
    const [sx, sy] = starts[i]
    const back = backDirection(median)
    let best: StrokeLabel | null = null
    let bestCost = Infinity
    // Fallback when every candidate touches a badge: the one that overlaps least.
    let loosest: StrokeLabel | null = null
    let loosestGap = -Infinity

    for (let ring = 0; ring < RING_COUNT; ring++) {
      const dist = r + INK_GAP + ring * RING_STEP
      for (let a = 0; a < ANGLE_STEPS; a++) {
        const angle = (a / ANGLE_STEPS) * 2 * Math.PI
        const ux = Math.cos(angle)
        const uy = Math.sin(angle)
        const x = sx + ux * dist
        const y = sy + uy * dist
        if (x < minX || x > maxX || y < minY || y > maxY) continue

        const gap = nearestLabelGap(placed, x, y) - 2 * r
        if (gap < LABEL_GAP) {
          if (gap > loosestGap) {
            loosestGap = gap
            loosest = { x, y }
          }
          continue
        }

        let cost = dist + TURN_COST * Math.acos(clamp(ux * back[0] + uy * back[1], -1, 1))
        const clearance = distanceAt(dt, CLEARANCE_GRID, sourceToBox(x, y)) * BOX_UNITS
        if (clearance < r + INK_GAP) cost += INK_COST * (r + INK_GAP - clearance)
        const other = nearestOtherStart(starts, i, x, y)
        if (other < dist) cost += AMBIGUITY_FLAT + AMBIGUITY_COST * (dist - other)

        if (cost < bestCost) {
          bestCost = cost
          best = { x, y }
        }
      }
    }
    placed.push(best ?? loosest ?? { x: sx, y: sy })
  })
  return placed
}

/** Unit vector pointing from the stroke's start away from its first non-degenerate segment. */
function backDirection(median: readonly SourcePoint[]): [number, number] {
  const [x0, y0] = median[0]
  for (let k = 1; k < median.length; k++) {
    const dx = x0 - median[k][0]
    const dy = y0 - median[k][1]
    const len = Math.hypot(dx, dy)
    if (len > 0) return [dx / len, dy / len]
  }
  return [0, 1]
}

function nearestLabelGap(placed: readonly StrokeLabel[], x: number, y: number): number {
  let best = Infinity
  for (const p of placed) best = Math.min(best, Math.hypot(p.x - x, p.y - y))
  return best
}

function nearestOtherStart(starts: readonly SourcePoint[], own: number, x: number, y: number): number {
  let best = Infinity
  starts.forEach(([sx, sy], j) => {
    if (j !== own) best = Math.min(best, Math.hypot(sx - x, sy - y))
  })
  return best
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
