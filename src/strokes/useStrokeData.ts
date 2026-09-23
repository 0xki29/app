import { peekStrokeData } from './strokeData'
import type { StrokeData } from './types'

/**
 * Stroke data for `character`, or `null` if it has none (the font glyph is shown instead). The data
 * is bundled, so it is there on the first render: no loading state, no empty box.
 */
export function useStrokeData(character: string): StrokeData | null {
  return peekStrokeData(character)
}
