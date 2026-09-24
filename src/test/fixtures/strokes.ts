import { parseStrokeData } from '../../strokes/strokeData'
import type { StrokeData } from '../../strokes/types'

/**
 * Test-only: the stroke data of the five fixture characters (strokes/<code point in hex>.json,
 * byte-for-byte copies of hanzi-writer-data files; see strokes/README.md). The app never imports
 * this: it fetches stroke files at run time (src/strokes/strokeData.ts).
 */
export const FIXTURE_STROKE_FILES = import.meta.glob<unknown>('./strokes/*.json', { eager: true, import: 'default' })

const parsed = new Map<string, StrokeData | null>()

function fileKey(char: string): string {
  const cp = char.codePointAt(0)
  return cp === undefined ? '' : `./strokes/${cp.toString(16)}.json`
}

/** The fixture's stroke data for `char` (validated like the app's), or null when it has none. Same object every call. */
export function fixtureStrokeData(char: string): StrokeData | null {
  let data = parsed.get(char)
  if (data === undefined) {
    const key = fileKey(char)
    data = key in FIXTURE_STROKE_FILES ? parseStrokeData(FIXTURE_STROKE_FILES[key]) : null
    parsed.set(char, data)
  }
  return data
}

/** fixtureStrokeData, or a thrown error: for tests that need the data to be there. */
export function strokeFixture(char: string): StrokeData {
  const data = fixtureStrokeData(char)
  if (!data) throw new Error(`no stroke fixture for ${char}`)
  return data
}

/** A loader over the fixtures, for code written against the app's async loader (the scorer's provider). */
export function fixtureLoader(char: string): Promise<StrokeData | null> {
  return Promise.resolve(fixtureStrokeData(char))
}
