import type { SourcePoint, StrokeData } from './types'

/**
 * Stroke-order data bundled with the app, one lazily loaded chunk per character
 * (src/data/strokes/<code point in hex>.json). See src/data/strokes/README.md for source and license.
 */
const files = import.meta.glob<unknown>('../data/strokes/*.json', { import: 'default' })

const cache = new Map<string, Promise<StrokeData | null>>()
const loaded = new Map<string, StrokeData | null>()

function fileKey(character: string): string {
  const cp = character.codePointAt(0)
  return cp === undefined ? '' : `../data/strokes/${cp.toString(16)}.json`
}

/** True if stroke data for `character` ships with the app (synchronous; does not load it). */
export function hasStrokeData(character: string): boolean {
  return fileKey(character) in files
}

/**
 * Already-loaded data, synchronously: the data, `null` if the character has none (or it is
 * invalid), `undefined` if it has not been loaded yet.
 */
export function peekStrokeData(character: string): StrokeData | null | undefined {
  if (!hasStrokeData(character)) return null
  return loaded.get(character)
}

/** Loads (once) and validates the stroke data for `character`; `null` if there is none. */
export function getStrokeData(character: string): Promise<StrokeData | null> {
  let pending = cache.get(character)
  if (pending) return pending
  const load = files[fileKey(character)]
  if (!load) {
    loaded.set(character, null)
    return Promise.resolve(null)
  }
  pending = load().then(
    (json) => {
      const data = parseStrokeData(json)
      if (!data) console.warn(`[strokes] invalid stroke data for ${character}`)
      loaded.set(character, data)
      return data
    },
    (err: unknown) => {
      // A failed chunk load (offline, stale deploy) must not stick for the whole session.
      cache.delete(character)
      throw err
    },
  )
  cache.set(character, pending)
  return pending
}

/** Validates raw JSON; `null` if it is not usable stroke data. */
export function parseStrokeData(json: unknown): StrokeData | null {
  if (typeof json !== 'object' || json === null) return null
  const { strokes, medians, radStrokes } = json as Record<string, unknown>
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return null
  if (strokes.length === 0 || strokes.length !== medians.length) return null
  if (!strokes.every((s) => typeof s === 'string' && s.length > 0)) return null
  const parsedMedians: SourcePoint[][] = []
  for (const median of medians) {
    if (!Array.isArray(median) || median.length < 2) return null
    const points: SourcePoint[] = []
    for (const p of median) {
      if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
      points.push([p[0] as number, p[1] as number])
    }
    parsedMedians.push(points)
  }
  const rad =
    Array.isArray(radStrokes) && radStrokes.every((i) => Number.isInteger(i)) ? (radStrokes as number[]) : undefined
  return { strokes: strokes as string[], medians: parsedMedians, radStrokes: rad }
}
