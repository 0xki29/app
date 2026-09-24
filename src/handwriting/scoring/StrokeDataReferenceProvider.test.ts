import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_CHARS } from '../../test/fixtures/testChars'
import { rasterizeOutlines } from '../../strokes/rasterize'
import { fixtureLoader as getStrokeData } from '../../test/fixtures/strokes'
import { sourceToBox } from '../../strokes/transform'
import type { StrokeData } from '../../strokes/types'
import type { Ink } from '../types'
import { GRID_SIZE } from './config'
import { resample } from './geometry'
import { GeometryScorer, scoreGeometry } from './GeometryScorer'
import { STROKE_DATA_SOURCE, StrokeDataReferenceProvider } from './StrokeDataReferenceProvider'
import type { ReferenceCharacter, ReferenceProvider } from './types'

const FALLBACK_SOURCE = 'fallback glyph'

/** Stands in for the font provider: a recognizable, trivially small reference. */
function fakeFallback() {
  const getReference = vi.fn(
    async (character: string, _lang: string, strokeCount?: number): Promise<ReferenceCharacter> => ({
      character,
      strokeCount,
      glyph: { size: 2, data: new Uint8Array([1, 0, 0, 0]), source: FALLBACK_SOURCE },
    }),
  )
  return { getReference } satisfies ReferenceProvider
}

const TRIANGLE: StrokeData = {
  strokes: ['M 100 100 L 900 100 L 500 800 Z'],
  medians: [
    [
      [500, 200],
      [500, 700],
    ],
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StrokeDataReferenceProvider', () => {
  it('builds the glyph from the stroke outlines, with the data’s stroke count', async () => {
    const fallback = fakeFallback()
    const ref = await new StrokeDataReferenceProvider(fallback, getStrokeData).getReference('永', 'zh-Hans', 5)
    const data = (await getStrokeData('永'))!
    expect(ref.character).toBe('永')
    expect(ref.strokeCount).toBe(5)
    expect(ref.glyph?.size).toBe(GRID_SIZE)
    expect(ref.glyph?.source).toBe(STROKE_DATA_SOURCE)
    expect(ref.glyph?.data).toEqual(rasterizeOutlines(data, GRID_SIZE))
    // Not yet: `strokes` would switch the scorer to its uncalibrated "full" path.
    expect(ref.strokes).toBeUndefined()
    expect(ref.fromStrokeData).toBe(true)
    expect(fallback.getReference).not.toHaveBeenCalled()
  })

  it('the score says where the reference comes from: stroke data, its count, order not scored yet', async () => {
    const ref = await new StrokeDataReferenceProvider(fakeFallback(), getStrokeData).getReference('永', 'zh-Hans', 5)
    const r = scoreGeometry(tracedInk(DATA.get('永')!), ref, 'trace')
    expect(r.referenceSource).toBe(`${STROKE_DATA_SOURCE} + stroke count (stroke data)`)
    expect(r.breakdown.strokeOrder).toBeNull()
    expect(r.diagnostics.unavailable.strokeOrder).toBe('có dữ liệu, chưa chấm (chưa hiệu chỉnh)')
  })

  it('returns the same reference object per character, for any lang, and loads once', async () => {
    const load = vi.fn(async () => TRIANGLE)
    const provider = new StrokeDataReferenceProvider(fakeFallback(), load)
    const a = await provider.getReference('X', 'zh-Hans')
    const b = await provider.getReference('X', 'zh-Hant', 1)
    expect(b).toBe(a)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('uses the fallback for characters without stroke data', async () => {
    const fallback = fakeFallback()
    const ref = await new StrokeDataReferenceProvider(fallback, getStrokeData).getReference('王', 'zh-Hans', 4)
    expect(ref.glyph?.source).toBe(FALLBACK_SOURCE)
    expect(ref.strokeCount).toBe(4)
    expect(fallback.getReference).toHaveBeenCalledWith('王', 'zh-Hans', 4)
  })

  it('keeps the data’s stroke count over a mismatching one, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = new StrokeDataReferenceProvider(fakeFallback(), async () => TRIANGLE)
    expect((await provider.getReference('X', 'zh-Hans', 3)).strokeCount).toBe(1)
    expect((await provider.getReference('X', 'zh-Hans', 3)).strokeCount).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect((await provider.getReference('X', 'zh-Hans', 1)).strokeCount).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a failed load falls back for that call and is retried on the next one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const load = vi.fn<(c: string) => Promise<StrokeData | null>>()
    load.mockRejectedValueOnce(new Error('chunk load failed')).mockResolvedValue(TRIANGLE)
    const fallback = fakeFallback()
    const provider = new StrokeDataReferenceProvider(fallback, load)

    const first = await provider.getReference('X', 'zh-Hans', 1)
    expect(first.glyph?.source).toBe(FALLBACK_SOURCE)
    expect(warn).toHaveBeenCalledTimes(1)

    const second = await provider.getReference('X', 'zh-Hans', 1)
    expect(second.glyph?.source).toBe(STROKE_DATA_SOURCE)
    expect(load).toHaveBeenCalledTimes(2)
    expect(fallback.getReference).toHaveBeenCalledTimes(1)
  })

  it('scores against the font glyph when the file is not in after the wait, and uses it once it is (PERF-1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let arrive!: (d: StrokeData) => void
    const load = vi.fn(() => new Promise<StrokeData | null>((r) => (arrive = r)))
    const provider = new StrokeDataReferenceProvider(fakeFallback(), load, 20)
    expect((await provider.getReference('X', 'zh-Hans', 1)).glyph?.source).toBe(FALLBACK_SOURCE)
    expect(warn).toHaveBeenCalledTimes(1)
    arrive(TRIANGLE)
    expect((await provider.getReference('X', 'zh-Hans', 1)).glyph?.source).toBe(STROKE_DATA_SOURCE)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a synchronous loader error is handled like a failed load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = new StrokeDataReferenceProvider(fakeFallback(), () => {
      throw new Error('boom')
    })
    expect((await provider.getReference('X', 'zh-Hans')).glyph?.source).toBe(FALLBACK_SOURCE)
  })

  it('outlines that cannot be drawn fall back for good (no retry loop)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken: StrokeData = { ...TRIANGLE, strokes: ['M 100 100 A 50 50 0 0 1 900 100 Z'] }
    const load = vi.fn(async () => broken)
    const provider = new StrokeDataReferenceProvider(fakeFallback(), load)
    expect((await provider.getReference('X', 'zh-Hans')).glyph?.source).toBe(FALLBACK_SOURCE)
    expect((await provider.getReference('X', 'zh-Hans')).glyph?.source).toBe(FALLBACK_SOURCE)
    expect(load).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// ── End-to-end alignment ────────────────────────────────────────────────────
// Ink that traces a character's medians must score high against the reference built from its
// outlines. That only holds if outlines, medians, the dataset→box transform and the raster's pixel
// convention all agree — i.e. if what the learner sees (and traces) is what is scored.

const DATA = new Map<string, StrokeData>()

beforeAll(async () => {
  for (const { char } of TEST_CHARS) DATA.set(char, (await getStrokeData(char))!)
})

/** User ink that follows each median in writing order: ~0.01 box between samples, like a pointer. */
function tracedInk(data: StrokeData, dx = 0, dy = 0): Ink {
  return {
    strokes: data.medians.map((median) => ({
      points: resample(
        median.map(([x, y]) => sourceToBox(x, y)),
        0.01,
      ).map((p, i) => ({ x: p.x + dx, y: p.y + dy, t: i * 8, p: 0.5 })),
      pointerType: 'touch' as const,
    })),
  }
}

describe('stroke-data reference: end-to-end alignment with the scorer', () => {
  const provider = new StrokeDataReferenceProvider(fakeFallback(), getStrokeData)

  // Measured (trace / recall): 永 98/98 · 你 98/98 · 学 98/98 · 國 97/98 · 謝 97/97.
  it.each(TEST_CHARS.map((c) => [c.char, c.strokeCount] as const))(
    '%s: tracing the medians scores high in both modes',
    async (char, strokeCount) => {
      const ref = await provider.getReference(char, 'zh', strokeCount)
      const ink = tracedInk(DATA.get(char)!)
      const trace = scoreGeometry(ink, ref, 'trace')
      expect(trace.status).toBe('scored')
      expect(trace.referenceLevel).toBe('partial')
      expect(trace.referenceSource).toContain(STROKE_DATA_SOURCE)
      expect(trace.breakdown.strokeCount).toBe(100)
      expect(trace.total).toBeGreaterThanOrEqual(90)
      expect(scoreGeometry(ink, ref, 'recall').total).toBeGreaterThanOrEqual(90)
      expect(await new GeometryScorer().score(ink, ref, 'trace')).toEqual(trace)
    },
  )

  // Measured, max over the four diagonal shifts: 永 45 · 你 52 · 学 48 · 國 53 · 謝 55.
  it.each(TEST_CHARS.map((c) => c.char))('%s: the same ink shifted by ~0.08 box scores clearly lower', async (char) => {
    const ref = await provider.getReference(char, 'zh')
    const traced = scoreGeometry(tracedInk(DATA.get(char)!), ref, 'trace').total
    for (const [dx, dy] of [
      [0.06, 0.06],
      [-0.06, 0.06],
      [0.06, -0.06],
      [-0.06, -0.06],
    ]) {
      const shifted = scoreGeometry(tracedInk(DATA.get(char)!, dx, dy), ref, 'trace').total
      expect(shifted, `${dx},${dy}`).toBeLessThanOrEqual(70)
      expect(traced - shifted, `${dx},${dy}`).toBeGreaterThanOrEqual(30)
    }
  })

  // Measured, max over the other four characters: 永 45 · 你 52 · 学 51 · 國 60 · 謝 63.
  it.each(TEST_CHARS.map((c) => c.char))('%s: another character’s medians score clearly lower', async (char) => {
    const ref = await provider.getReference(char, 'zh')
    const traced = scoreGeometry(tracedInk(DATA.get(char)!), ref, 'trace').total
    for (const { char: other } of TEST_CHARS) {
      if (other === char) continue
      const wrong = scoreGeometry(tracedInk(DATA.get(other)!), ref, 'trace').total
      expect(wrong, other).toBeLessThanOrEqual(72)
      expect(traced - wrong, other).toBeGreaterThanOrEqual(25)
    }
  })
})
