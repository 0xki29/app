import type { Grade, ScoreComponent, ScoringMode } from './types'

/**
 * Heuristic tuning knobs — the one place to adjust scoring. Distances are in character-box units
 * (1 = box width).
 */
export interface ModeConfig {
  /** Relative weights; renormalized over the components that can actually be scored. */
  weights: Record<ScoreComponent, number>
  /**
   * Recall: align the ink's bounding box to the reference before judging shape, so a well-formed
   * but shifted/scaled character is not punished twice. Trace compares in place.
   */
  alignForShape: boolean
  /**
   * A user sample counts as "on the reference" within this distance of the reference centerline
   * (≈ half a Kai stroke's width, so tracing anywhere inside the stroke body counts) — and only if
   * its direction matches within DIRECTION_TOLERANCE_DEG.
   */
  precisionTolerance: number
  /** A reference centerline point counts as "covered" by same-direction user ink within this distance. */
  coverageTolerance: number
  /** Mean distance of user ink to reference ink at which the position score reaches 0. */
  positionTolerance: number
}

export const MODE_CONFIG: Record<ScoringMode, ModeConfig> = {
  trace: {
    // strokeOrder: 0 until real stroke-order data exists.
    weights: { shape: 0.4, position: 0.35, length: 0.15, strokeCount: 0.1, strokeOrder: 0 },
    alignForShape: false,
    precisionTolerance: 0.045,
    coverageTolerance: 0.045,
    positionTolerance: 0.05,
  },
  recall: {
    weights: { shape: 0.5, position: 0.25, length: 0.15, strokeCount: 0.1, strokeOrder: 0 },
    alignForShape: true,
    precisionTolerance: 0.05,
    coverageTolerance: 0.05,
    positionTolerance: 0.15,
  },
}

/** Max orientation difference for ink to match a reference stroke (undirected). */
export const DIRECTION_TOLERANCE_DEG = 30

/** Length ratio (user / reference) at which the length score reaches 0, e.g. 3 → ×3 or ×⅓. */
export const LENGTH_RATIO_ZERO = 3

/** Stroke width used to rasterize stroke-based references (≈ a Kai glyph's stroke). */
export const REFERENCE_STROKE_WIDTH = 0.07

/** Resolution of the scoring grid (pixels per box side). */
export const GRID_SIZE = 128

/** Ink resampling step for scoring, box units. */
export const SAMPLE_SPACING = 0.004

/** Minimum score for each grade, checked top-down. */
export const GRADE_THRESHOLDS: readonly { grade: Grade; min: number }[] = [
  { grade: 'excellent', min: 90 },
  { grade: 'good', min: 75 },
  { grade: 'fair', min: 60 },
  { grade: 'needs-work', min: 0 },
]

export const GRADE_LABEL: Record<Grade, string> = {
  excellent: 'Rất tốt',
  good: 'Khá tốt',
  fair: 'Cần luyện thêm',
  'needs-work': 'Thử lại',
}

/** Component score (0–100) below which a specific hint is shown. */
export const WEAK_COMPONENT = 60
