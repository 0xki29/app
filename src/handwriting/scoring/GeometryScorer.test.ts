import { describe, expect, it } from 'vitest'
import type { Ink, Stroke } from '../types'
import { GRID_SIZE, MODE_CONFIG, REFERENCE_STROKE_WIDTH } from './config'
import { gradeFor } from './feedback'
import { rasterizePolylines, resample } from './geometry'
import { GeometryScorer, scoreGeometry } from './GeometryScorer'
import type { ReferenceCharacter, Vec } from './types'

// Test fixture only — a synthetic 王-like shape, not product stroke data.
const REF_LINES: Vec[][] = [
  [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }],
  [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }],
  [{ x: 0.5, y: 0.25 }, { x: 0.5, y: 0.8 }],
  [{ x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }],
]
const strokeRef = (): ReferenceCharacter => ({ character: '王', strokes: REF_LINES.map((points) => ({ points })) })
const glyphRef = (): ReferenceCharacter => ({
  character: '王',
  strokeCount: 4,
  glyph: { size: GRID_SIZE, data: rasterizePolylines(REF_LINES, GRID_SIZE, REFERENCE_STROKE_WIDTH), source: 'test glyph' },
})

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Densely sampled user stroke along a polyline, with optional offset and deterministic jitter. */
function drawn(line: Vec[], opts: { dx?: number; dy?: number; jitter?: number; seed?: number; steps?: number } = {}): Stroke {
  const { dx = 0, dy = 0, jitter = 0, seed = 1, steps = 40 } = opts
  const r = rng(seed)
  const points = []
  for (let seg = 1; seg < line.length; seg++) {
    const a = line[seg - 1]
    const b = line[seg]
    for (let i = seg === 1 ? 0 : 1; i <= steps; i++) {
      const t = i / steps
      points.push({
        x: a.x + (b.x - a.x) * t + dx + (r() - 0.5) * 2 * jitter,
        y: a.y + (b.y - a.y) * t + dy + (r() - 0.5) * 2 * jitter,
        t: points.length * 8,
        p: 0.5,
      })
    }
  }
  return { points, pointerType: 'mouse' }
}

const ink = (strokes: Stroke[]): Ink => ({ strokes })
const nearInk = () => ink(REF_LINES.map((l, i) => drawn(l, { dx: 0.01, dy: 0.008, jitter: 0.004, seed: i + 1 })))

describe('scoreGeometry', () => {
  it('no strokes → empty result, score 0', () => {
    const r = scoreGeometry(ink([]), strokeRef(), 'trace')
    expect(r.status).toBe('empty')
    expect(r.total).toBe(0)
    expect(r.grade).toBe('needs-work')
    expect(r.feedback[0]).toMatch(/Chưa có nét/)
  })

  it('a single very short stroke scores low', () => {
    const tiny = ink([drawn([{ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }], { steps: 2 })])
    for (const mode of ['trace', 'recall'] as const) {
      const r = scoreGeometry(tiny, strokeRef(), mode)
      expect(r.status).toBe('scored')
      expect(r.total).toBeLessThan(40)
    }
  })

  it('ink close to the reference scores high in both modes', () => {
    expect(scoreGeometry(nearInk(), strokeRef(), 'trace').total).toBeGreaterThanOrEqual(85)
    expect(scoreGeometry(nearInk(), strokeRef(), 'recall').total).toBeGreaterThanOrEqual(85)
  })

  it('ink far from the reference scores low', () => {
    const circle = (cx: number, cy: number, r: number): Vec[] =>
      Array.from({ length: 25 }, (_, i) => ({ x: cx + r * Math.cos((i / 24) * 2 * Math.PI), y: cy + r * Math.sin((i / 24) * 2 * Math.PI) }))
    const far = ink([0, 1, 2, 3].map((i) => drawn(circle(0.12 + i * 0.02, 0.1, 0.05), { seed: i })))
    const r = scoreGeometry(far, strokeRef(), 'trace')
    expect(r.total).toBeLessThan(35)
    expect(r.breakdown.position).toBeLessThan(30)
  })

  it('taps have no direction: dotting along the reference earns no shape', () => {
    // One tap every 0.02 box along every reference stroke: on the reference, but no stroke.
    const taps = REF_LINES.flatMap((l) =>
      resample(l, 0.02).map((p): Stroke => ({ points: [{ x: p.x, y: p.y, t: 0, p: 0.5 }], pointerType: 'touch' })),
    )
    for (const mode of ['trace', 'recall'] as const) {
      const r = scoreGeometry(ink(taps), strokeRef(), mode)
      expect(r.diagnostics.precision).toBe(0)
      expect(r.diagnostics.coverage).toBe(0)
      expect(r.breakdown.shape).toBe(0)
      expect(r.total).toBeLessThan(40)
    }
  })

  it('a wrong stroke count lowers the stroke-count component and the total', () => {
    const good = scoreGeometry(nearInk(), strokeRef(), 'trace')
    const missing = scoreGeometry(ink(nearInk().strokes.slice(0, 3)), strokeRef(), 'trace')
    expect(good.breakdown.strokeCount).toBe(100)
    expect(missing.breakdown.strokeCount).toBe(75)
    expect(missing.total).toBeLessThan(good.total)
    expect(missing.feedback.join(' ')).toMatch(/3 nét.*4 nét/)
  })

  it('is deterministic: same input → same result', () => {
    const a = scoreGeometry(nearInk(), glyphRef(), 'recall')
    const b = scoreGeometry(nearInk(), glyphRef(), 'recall')
    expect(a).toEqual(b)
  })

  it('trace uses the trace weights', () => {
    const r = scoreGeometry(nearInk(), strokeRef(), 'trace')
    const { strokeOrder: _unused, ...w } = MODE_CONFIG.trace.weights
    expect(r.diagnostics.weights).toEqual(w)
    expect(w).toEqual({ shape: 0.4, position: 0.35, length: 0.15, strokeCount: 0.1 })
    const b = r.breakdown
    const expected = (0.4 * b.shape! + 0.35 * b.position! + 0.15 * b.length! + 0.1 * b.strokeCount!) / 1.0
    expect(Math.abs(r.total - expected)).toBeLessThanOrEqual(1)
  })

  it('recall uses the recall weights and is more lenient about placement', () => {
    const r = scoreGeometry(nearInk(), strokeRef(), 'recall')
    const { strokeOrder: _unused, ...w } = MODE_CONFIG.recall.weights
    expect(r.diagnostics.weights).toEqual(w)
    expect(w).toEqual({ shape: 0.5, position: 0.25, length: 0.15, strokeCount: 0.1 })
    const b = r.breakdown
    const expected = 0.5 * b.shape! + 0.25 * b.position! + 0.15 * b.length! + 0.1 * b.strokeCount!
    expect(Math.abs(r.total - expected)).toBeLessThanOrEqual(1)

    // Correct form, written smaller and off-center: recall judges shape after alignment.
    const shifted = ink(
      REF_LINES.map((l, i) => drawn(l.map((p) => ({ x: 0.2 + p.x * 0.75, y: 0.15 + p.y * 0.75 })), { seed: i + 1 })),
    )
    const trace = scoreGeometry(shifted, strokeRef(), 'trace')
    const recall = scoreGeometry(shifted, strokeRef(), 'recall')
    expect(recall.breakdown.shape!).toBeGreaterThan(trace.breakdown.shape!)
    expect(recall.total).toBeGreaterThan(trace.total)
    expect(recall.breakdown.shape!).toBeGreaterThanOrEqual(85)
  })

  it('works without stroke data (glyph + stroke count) and says what it could not score', () => {
    const r = scoreGeometry(nearInk(), glyphRef(), 'trace')
    expect(r.referenceLevel).toBe('partial')
    expect(r.status).toBe('scored')
    expect(r.breakdown.strokeOrder).toBeNull()
    expect(r.diagnostics.unavailable.strokeOrder).toBeTruthy()
    expect(r.breakdown.shape).not.toBeNull()
    expect(r.total).toBeGreaterThanOrEqual(80)
  })

  it('without any geometric reference it refuses to produce a score', () => {
    for (const ref of [{ character: '王' }, { character: '王', strokeCount: 4 }]) {
      const r = scoreGeometry(nearInk(), ref, 'trace')
      expect(r.status).toBe('insufficient-reference')
      expect(r.total).toBe(0)
      expect(r.breakdown.shape).toBeNull()
    }
    expect(scoreGeometry(nearInk(), { character: '王' }, 'trace').referenceLevel).toBe('unavailable')
  })

  it('stroke order is never scored without real stroke-order support', () => {
    expect(scoreGeometry(nearInk(), strokeRef(), 'trace').breakdown.strokeOrder).toBeNull()
  })

  it('always returns integer scores within 0–100', () => {
    const r = rng(42)
    for (let k = 0; k < 60; k++) {
      const strokes = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) =>
        drawn(
          Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ x: r() * 1.4 - 0.2, y: r() * 1.4 - 0.2 })),
          { seed: k * 10 + i, jitter: r() * 0.05, steps: 1 + Math.floor(r() * 20) },
        ),
      )
      for (const ref of [strokeRef(), glyphRef()]) {
        for (const mode of ['trace', 'recall'] as const) {
          const res = scoreGeometry(ink(strokes), ref, mode)
          for (const v of [res.total, ...Object.values(res.breakdown)]) {
            if (v === null) continue
            expect(Number.isInteger(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(100)
          }
        }
      }
    }
  })

  it('GeometryScorer exposes the same result through the async interface', async () => {
    const scorer = new GeometryScorer()
    expect(await scorer.score(nearInk(), strokeRef(), 'trace')).toEqual(scoreGeometry(nearInk(), strokeRef(), 'trace'))
  })
})

describe('gradeFor', () => {
  it.each([
    [0, 'needs-work'],
    [59, 'needs-work'],
    [60, 'fair'],
    [74, 'fair'],
    [75, 'good'],
    [89, 'good'],
    [90, 'excellent'],
    [100, 'excellent'],
  ] as const)('%i → %s', (score, grade) => {
    expect(gradeFor(score)).toBe(grade)
  })
})
