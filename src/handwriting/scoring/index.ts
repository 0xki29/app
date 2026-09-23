import { GeometryScorer } from './GeometryScorer'
import { GlyphReferenceProvider } from './GlyphReferenceProvider'
import { StrokeDataReferenceProvider } from './StrokeDataReferenceProvider'
import type { HandwritingScorer, ReferenceProvider } from './types'

/**
 * The scoring backends used by the app; the UI only depends on the interfaces. The reference is
 * the bundled stroke data's glyph (the same outlines the learner sees), falling back to the
 * device-font glyph for characters without stroke data. An ML scorer would be swapped in here.
 */
export const scorer: HandwritingScorer = new GeometryScorer()
export const referenceProvider: ReferenceProvider = new StrokeDataReferenceProvider(new GlyphReferenceProvider())

export { GRADE_LABEL } from './config'
export type { Grade, ScoreResult, ScoringMode } from './types'
