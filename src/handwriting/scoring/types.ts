import type { Ink } from '../types'

export type ScoringMode = 'trace' | 'recall'

export interface Vec {
  x: number
  y: number
}

/** One reference stroke in writing order, normalized to the character box like user ink. */
export interface ReferenceStroke {
  points: Vec[]
}

/**
 * Binary raster of the reference glyph, square, row-major, 1 = ink.
 * Produced from a font by a ReferenceProvider — never from screen pixels.
 */
export interface GlyphMask {
  size: number
  data: Uint8Array
  /** Human-readable origin, shown in the debug HUD. */
  source: string
}

/**
 * Everything the scorer may know about the target character. All fields are optional data
 * sources; the scorer uses what is present and reports what it could not score.
 */
export interface ReferenceCharacter {
  character: string
  /** Real stroke data (e.g. from a licensed stroke-order dataset). Enables "full" scoring. */
  strokes?: ReferenceStroke[]
  /** Standard stroke count, when strokes are not available. */
  strokeCount?: number
  /** Font glyph raster: shape/position/length without per-stroke data. */
  glyph?: GlyphMask
}

/** full = real stroke data · partial = glyph and/or stroke count · unavailable = nothing to compare. */
export type ReferenceLevel = 'full' | 'partial' | 'unavailable'

export type ScoreComponent = 'shape' | 'position' | 'length' | 'strokeCount' | 'strokeOrder'

export type Grade = 'excellent' | 'good' | 'fair' | 'needs-work'

/** Component scores 0–100. `null` = could not be scored with the available reference data. */
export interface ScoreBreakdown {
  total: number
  shape: number | null
  position: number | null
  length: number | null
  strokeCount: number | null
  strokeOrder: number | null
}

/** Raw measurements behind the breakdown, for the debug HUD only. */
export interface ScoreDiagnostics {
  precision: number | null
  coverage: number | null
  meanDistance: number | null
  lengthRatio: number | null
  userLength: number
  referenceLength: number | null
  userStrokes: number
  referenceStrokes: number | null
  weights: Partial<Record<ScoreComponent, number>>
  /** Why each missing component is missing. */
  unavailable: Partial<Record<ScoreComponent, string>>
}

export interface ScoreResult {
  /** 'insufficient-reference': nothing geometric to compare against; total is 0 and must not be shown as a score. */
  status: 'scored' | 'empty' | 'insufficient-reference'
  total: number
  grade: Grade
  breakdown: ScoreBreakdown
  /** Short Vietnamese feedback lines for the learner (≤ 2). */
  feedback: string[]
  engine: string
  mode: ScoringMode
  referenceLevel: ReferenceLevel
  referenceSource: string
  diagnostics: ScoreDiagnostics
}

/**
 * The only thing the UI knows about scoring. Async so that a future ML scorer (model inference)
 * fits the same contract as the synchronous geometry heuristic.
 */
export interface HandwritingScorer {
  readonly id: string
  score(userInk: Ink, reference: ReferenceCharacter, mode: ScoringMode): Promise<ScoreResult>
}

/** Supplies reference data for a character. Swappable (font glyph today, stroke dataset later). */
export interface ReferenceProvider {
  getReference(character: string, lang: string, strokeCount?: number): Promise<ReferenceCharacter>
}
