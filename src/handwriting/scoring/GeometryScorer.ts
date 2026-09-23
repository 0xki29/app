import type { Ink } from '../types'
import {
  DIRECTION_TOLERANCE_DEG,
  GRID_SIZE,
  LENGTH_RATIO_ZERO,
  MODE_CONFIG,
  REFERENCE_STROKE_WIDTH,
  SAMPLE_SPACING,
} from './config'
import { feedbackFor, gradeFor } from './feedback'
import {
  align,
  alignmentScale,
  boundsOf,
  cellCenters,
  distanceAt,
  distanceTransform,
  indexPoints,
  matchFraction,
  polylineLength,
  polylineOrientations,
  rasterizePoints,
  rasterizePolylines,
  resample,
  resampleGrid,
  skeletonize,
  skeletonOrientations,
  SKELETON_LENGTH_PER_CELL,
  type Bounds,
  type PointIndex,
} from './geometry'
import type {
  HandwritingScorer,
  ReferenceCharacter,
  ReferenceLevel,
  ScoreBreakdown,
  ScoreComponent,
  ScoreDiagnostics,
  ScoreResult,
  ScoringMode,
  Vec,
} from './types'

export const GEOMETRY_ENGINE_ID = 'geometry-v1'

/**
 * Heuristic scorer: compares the geometry of the user's strokes with the reference. No
 * recognition, no ML. Deterministic: same ink + reference + mode → same result.
 */
export class GeometryScorer implements HandwritingScorer {
  readonly id = GEOMETRY_ENGINE_ID

  async score(userInk: Ink, reference: ReferenceCharacter, mode: ScoringMode): Promise<ScoreResult> {
    return scoreGeometry(userInk, reference, mode)
  }
}

/** What the reference looks like on the scoring grid, derived once per reference. */
interface ReferenceGeometry {
  /** Distance (cells) to the nearest reference ink cell (stroke body), for position. */
  dt: Float32Array
  /** Points along the reference strokes' centerlines — what "coverage" must reach. */
  centerline: Vec[]
  /** Orientation at each centerline point (doubled-angle vectors). */
  centerDir: Float32Array
  centerIndex: PointIndex
  centerlineLength: number
  bounds: Bounds
  source: string
}

const geometryCache = new WeakMap<ReferenceCharacter, ReferenceGeometry | null>()

export function referenceLevel(ref: ReferenceCharacter): ReferenceLevel {
  if (ref.strokes && ref.strokes.length > 0) return 'full'
  if (ref.glyph || ref.strokeCount) return 'partial'
  return 'unavailable'
}

function referenceGeometry(ref: ReferenceCharacter): ReferenceGeometry | null {
  const cached = geometryCache.get(ref)
  if (cached !== undefined) return cached
  let geom: ReferenceGeometry | null = null
  const n = GRID_SIZE

  if (ref.strokes && ref.strokes.length > 0) {
    const lines = ref.strokes.map((s) => resample(s.points, SAMPLE_SPACING))
    const centerline = lines.flat()
    geom = {
      dt: distanceTransform(rasterizePolylines(lines, n, REFERENCE_STROKE_WIDTH), n),
      centerline,
      centerDir: concatDirs(lines.map(polylineOrientations)),
      centerIndex: indexPoints(centerline, n),
      centerlineLength: ref.strokes.reduce((sum, s) => sum + polylineLength(s.points), 0),
      bounds: boundsOf(centerline),
      source: 'stroke data',
    }
  } else if (ref.glyph) {
    const mask = resampleGrid(ref.glyph.data, ref.glyph.size, n)
    const skeleton = skeletonize(mask, n)
    const centerline = cellCenters(skeleton, n)
    if (centerline.length > 0) {
      geom = {
        dt: distanceTransform(mask, n),
        centerline,
        centerDir: skeletonOrientations(skeleton, n, centerline),
        centerIndex: indexPoints(centerline, n),
        centerlineLength: (centerline.length * SKELETON_LENGTH_PER_CELL) / n,
        bounds: boundsOf(centerline),
        source: ref.glyph.source,
      }
    }
  }
  geometryCache.set(ref, geom)
  return geom
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const pct = (v: number) => Math.round(clamp01(v) * 100)

export function scoreGeometry(ink: Ink, ref: ReferenceCharacter, mode: ScoringMode): ScoreResult {
  const cfg = MODE_CONFIG[mode]
  const n = GRID_SIZE
  const strokes = ink.strokes.filter((s) => s.points.length > 0)
  const geom = referenceGeometry(ref)
  const refStrokes = ref.strokes && ref.strokes.length > 0 ? ref.strokes.length : (ref.strokeCount ?? null)
  const userLength = strokes.reduce((sum, s) => sum + polylineLength(s.points), 0)

  const unavailable: ScoreDiagnostics['unavailable'] = {}
  const diagnostics: ScoreDiagnostics = {
    precision: null,
    coverage: null,
    meanDistance: null,
    lengthRatio: null,
    userLength,
    referenceLength: geom?.centerlineLength ?? null,
    userStrokes: strokes.length,
    referenceStrokes: refStrokes,
    weights: {},
    unavailable,
  }
  const scores: Record<ScoreComponent, number | null> = {
    shape: null,
    position: null,
    length: null,
    strokeCount: null,
    strokeOrder: null,
  }

  unavailable.strokeOrder = ref.strokes
    ? 'chưa triển khai: cần kiểm chứng với dữ liệu thứ tự nét thật'
    : ref.fromStrokeData
      ? 'có dữ liệu, chưa chấm (chưa hiệu chỉnh)'
      : 'không có dữ liệu thứ tự nét'
  if (!geom) {
    const why = 'không có dữ liệu hình học của chữ mẫu'
    unavailable.shape = why
    unavailable.position = why
    unavailable.length = why
  }
  if (refStrokes === null) unavailable.strokeCount = 'không có số nét chuẩn'

  const base = {
    engine: GEOMETRY_ENGINE_ID,
    mode,
    referenceLevel: referenceLevel(ref),
    referenceSource: describeSource(ref, geom),
    diagnostics,
  }

  if (strokes.length === 0) {
    return {
      ...base,
      status: 'empty',
      total: 0,
      grade: 'needs-work',
      breakdown: toBreakdown(0, scores),
      feedback: ['Chưa có nét nào để chấm.'],
    }
  }

  if (refStrokes !== null) {
    scores.strokeCount = clamp01(1 - Math.abs(strokes.length - refStrokes) / refStrokes)
  }

  if (geom) {
    const samplesPerStroke = strokes.map((s) => resample(s.points, SAMPLE_SPACING))
    const raw = samplesPerStroke.flat()

    // Position: symmetric mean distance, in place — ink → reference ink, and reference
    // centerline → ink. One-sided would give a dot placed on the reference a perfect position.
    let toRef = 0
    for (const p of raw) toRef += distanceAt(geom.dt, n, p)
    const rawDt = distanceTransform(rasterizePoints(raw, n), n)
    let toInk = 0
    for (const c of geom.centerline) toInk += distanceAt(rawDt, n, c)
    const meanDistance = (toRef / raw.length + toInk / geom.centerline.length) / 2
    scores.position = clamp01(1 - meanDistance / cfg.positionTolerance)

    // Shape: oriented matching between ink and reference centerline, both ways, as an F-score.
    // precision = ink that runs along a reference stroke; coverage = reference strokes reached by
    // ink running the same way. Direction keeps scribbles and hatching from "covering" a glyph.
    const scale = cfg.alignForShape ? alignmentScale(boundsOf(raw), geom.bounds) : 1
    const shaped = cfg.alignForShape ? align(raw, boundsOf(raw), geom.bounds, scale) : raw
    const inkDir = concatDirs(samplesPerStroke.map(polylineOrientations))
    const minSim = Math.cos((2 * DIRECTION_TOLERANCE_DEG * Math.PI) / 180)
    const precision = matchFraction(shaped, inkDir, geom.centerline, geom.centerDir, geom.centerIndex, cfg.precisionTolerance, minSim)
    const coverage = matchFraction(geom.centerline, geom.centerDir, shaped, inkDir, indexPoints(shaped, n), cfg.coverageTolerance, minSim)
    scores.shape = precision + coverage > 0 ? (2 * precision * coverage) / (precision + coverage) : 0

    // Length: total ink length vs reference centerline length (scale-normalized when aligned).
    const lengthRatio = (userLength * scale) / geom.centerlineLength
    let length = clamp01(1 - Math.abs(Math.log(lengthRatio)) / Math.log(LENGTH_RATIO_ZERO))
    if (ref.strokes && ref.strokes.length === strokes.length && userLength > 0) {
      // Real stroke data: also compare each stroke's share of the total, in writing order.
      const refTotal = geom.centerlineLength
      let variation = 0
      strokes.forEach((s, i) => {
        variation += Math.abs(polylineLength(s.points) / userLength - polylineLength(ref.strokes![i].points) / refTotal)
      })
      length = 0.5 * length + 0.5 * clamp01(1 - variation / 2)
    }
    scores.length = length

    Object.assign(diagnostics, { precision, coverage, meanDistance, lengthRatio })
  }

  let weighted = 0
  let weightSum = 0
  for (const key of Object.keys(scores) as ScoreComponent[]) {
    const s = scores[key]
    const w = cfg.weights[key]
    if (s === null || w <= 0) continue
    diagnostics.weights[key] = w
    weighted += w * s
    weightSum += w
  }

  if (!geom) {
    // A stroke count alone must not masquerade as a handwriting score.
    return {
      ...base,
      status: 'insufficient-reference',
      total: 0,
      grade: 'needs-work',
      breakdown: toBreakdown(0, scores),
      feedback: ['Chưa có dữ liệu mẫu để chấm chữ này.'],
    }
  }

  const total = weightSum > 0 ? pct(weighted / weightSum) : 0
  const breakdown = toBreakdown(total, scores)
  const grade = gradeFor(total)
  return { ...base, status: 'scored', total, grade, breakdown, feedback: feedbackFor(grade, breakdown, diagnostics) }
}

function concatDirs(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function toBreakdown(total: number, s: Record<ScoreComponent, number | null>): ScoreBreakdown {
  const p = (v: number | null) => (v === null ? null : pct(v))
  return {
    total,
    shape: p(s.shape),
    position: p(s.position),
    length: p(s.length),
    strokeCount: p(s.strokeCount),
    strokeOrder: p(s.strokeOrder),
  }
}

function describeSource(ref: ReferenceCharacter, geom: ReferenceGeometry | null): string {
  const parts: string[] = []
  if (geom) parts.push(geom.source)
  if (!(ref.strokes && ref.strokes.length > 0) && ref.strokeCount) {
    parts.push(ref.fromStrokeData ? 'stroke count (stroke data)' : 'standard stroke count')
  }
  return parts.length > 0 ? parts.join(' + ') : 'none'
}
