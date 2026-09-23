import { rasterizeOutlines } from '../../strokes/rasterize'
import { getStrokeData } from '../../strokes/strokeData'
import type { StrokeData } from '../../strokes/types'
import { GRID_SIZE } from './config'
import type { ReferenceCharacter, ReferenceProvider } from './types'

export const STROKE_DATA_SOURCE = 'stroke data (Make Me a Hanzi)'

export type StrokeDataLoader = (character: string) => Promise<StrokeData | null>

/**
 * Reference from the bundled stroke data: the glyph mask is filled from the same outlines, through
 * the same transform, as the glyph the learner sees (src/strokes), so the score is measured against
 * exactly what is on screen. Characters without stroke data go to `fallback` (the device font).
 *
 * `ReferenceCharacter.strokes` is deliberately left unset. It would switch GeometryScorer to its
 * "full" path (a round-pen raster of the medians plus index-paired per-stroke lengths), which has
 * not been calibrated; that change belongs with stroke-order scoring. Until then the data feeds the
 * calibrated glyph path — only the glyph's source changes — plus its exact stroke count.
 */
export class StrokeDataReferenceProvider implements ReferenceProvider {
  /** Per character (the data does not depend on lang): its reference, or null = no data, use fallback. */
  private readonly cache = new Map<string, Promise<ReferenceCharacter | null>>()
  private readonly warned = new Set<string>()
  private readonly fallback: ReferenceProvider
  private readonly load: StrokeDataLoader

  constructor(fallback: ReferenceProvider, load: StrokeDataLoader = getStrokeData) {
    this.fallback = fallback
    this.load = load
  }

  async getReference(character: string, lang: string, strokeCount?: number): Promise<ReferenceCharacter> {
    let pending = this.cache.get(character)
    if (!pending) {
      pending = loadReference(this.load, character)
      this.cache.set(character, pending)
    }
    let ref: ReferenceCharacter | null
    try {
      ref = await pending
    } catch (err) {
      // The bundled data cannot fail to load, but a loader may: forget the failure so the next
      // call asks the loader again, and score this attempt against the font rather than failing it.
      if (this.cache.get(character) === pending) this.cache.delete(character)
      console.warn(`[scoring] stroke data for ${character} failed to load; using the font glyph`, err)
      return this.fallback.getReference(character, lang, strokeCount)
    }
    if (!ref) return this.fallback.getReference(character, lang, strokeCount)
    if (strokeCount !== undefined && strokeCount !== ref.strokeCount && !this.warned.has(character)) {
      // The data's strokes are what the learner is shown and animated, so its count wins.
      this.warned.add(character)
      console.warn(`[scoring] ${character}: stroke data has ${ref.strokeCount} strokes, expected ${strokeCount}`)
    }
    return ref
  }
}

async function loadReference(load: StrokeDataLoader, character: string): Promise<ReferenceCharacter | null> {
  const data = await load(character)
  return data ? buildReference(character, data) : null
}

/**
 * The same object is returned for every call, so GeometryScorer's per-reference geometry cache
 * (skeleton, distance transform) is computed once per character. `null` for data that cannot be
 * drawn: that is permanent, so it is cached and the character stays on the font fallback.
 */
function buildReference(character: string, data: StrokeData): ReferenceCharacter | null {
  let mask: Uint8Array
  try {
    mask = rasterizeOutlines(data, GRID_SIZE)
  } catch (err) {
    console.warn(`[scoring] unusable stroke outlines for ${character}; using the font glyph`, err)
    return null
  }
  if (!mask.includes(1)) return null
  return {
    character,
    strokeCount: data.strokes.length,
    glyph: { size: GRID_SIZE, data: mask, source: STROKE_DATA_SOURCE },
    fromStrokeData: true,
  }
}
