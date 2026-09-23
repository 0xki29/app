import type { SourcePoint, StrokeData } from './types'

/**
 * Stroke-order data bundled with the app (src/data/strokes/<code point in hex>.json; see
 * src/data/strokes/README.md for source and license — every build ships both under licenses/,
 * see vite.config.ts).
 *
 * Bundled eagerly: the five files are ~14 KB in all, and having them synchronously means a character
 * never shows an empty box while its data loads, and nothing can fail at runtime. (A lazy import()
 * would also not recover from a network error: browsers keep a failed dynamic import for the life of
 * the document. When the set grows, load it with `query: '?url'` + fetch() so a retry refetches.)
 */
const files = import.meta.glob<unknown>('../data/strokes/*.json', { eager: true, import: 'default' })

const parsed = new Map<string, StrokeData | null>()

function fileKey(character: string): string {
  const cp = character.codePointAt(0)
  return cp === undefined ? '' : `../data/strokes/${cp.toString(16)}.json`
}

/** True if stroke data for `character` ships with the app. */
export function hasStrokeData(character: string): boolean {
  return fileKey(character) in files
}

/**
 * The stroke data for `character`, synchronously: `null` if it has none (or it is invalid).
 * Validated once per character; the same object is returned every time.
 */
export function peekStrokeData(character: string): StrokeData | null {
  let data = parsed.get(character)
  if (data !== undefined) return data
  const key = fileKey(character)
  data = key in files ? parseStrokeData(files[key]) : null
  if (data === null && key in files) console.warn(`[strokes] invalid stroke data for ${character}`)
  parsed.set(character, data)
  return data
}

/** Async form of peekStrokeData, for callers written against a loader (the scorer's provider). */
export function getStrokeData(character: string): Promise<StrokeData | null> {
  return Promise.resolve(peekStrokeData(character))
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
