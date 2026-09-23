import { GeometryScorer } from './GeometryScorer'
import { GlyphReferenceProvider } from './GlyphReferenceProvider'
import type { HandwritingScorer, ReferenceProvider } from './types'

/**
 * The scoring backends used by the app. Swapping in an ML scorer or a stroke-data reference
 * provider happens here; the UI only depends on the interfaces.
 */
export const scorer: HandwritingScorer = new GeometryScorer()
export const referenceProvider: ReferenceProvider = new GlyphReferenceProvider()

export { GRADE_LABEL } from './config'
export type { Grade, ScoreResult, ScoringMode } from './types'
