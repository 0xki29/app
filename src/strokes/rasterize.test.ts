import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../data/testChars'
import { GRID_SIZE } from '../handwriting/scoring/config'
import { rasterizePoints, resample } from '../handwriting/scoring/geometry'
import { rasterizeOutlines } from './rasterize'
import { getStrokeData } from './strokeData'
import { sourceToBox } from './transform'
import type { StrokeData } from './types'

const N = GRID_SIZE

// sourceToBox inverted numerically (it is affine), to write test shapes in grid units.
const origin = sourceToBox(0, 0)
const unit = sourceToBox(1, 1)
const gridToSource = (gx: number, gy: number): [number, number] => [
  (gx / N - origin.x) / (unit.x - origin.x),
  (gy / N - origin.y) / (unit.y - origin.y),
]

/** Path data for a polygon given in grid units. */
function path(points: readonly (readonly [number, number])[]): string {
  return points.map(([gx, gy], i) => `${i === 0 ? 'M' : 'L'} ${gridToSource(gx, gy).join(' ')}`).join(' ') + ' Z'
}

/** Axis-aligned rectangle in grid units; `reverse` flips its winding direction. */
function rect(x0: number, y0: number, x1: number, y1: number, reverse = false): string {
  const pts: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  return path(reverse ? pts.reverse() : pts)
}

const glyph = (...strokes: string[]): StrokeData => ({
  strokes,
  medians: strokes.map(() => [
    [0, 0],
    [1, 1],
  ]),
})

const count = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0)

describe('rasterizeOutlines', () => {
  it('marks exactly the pixels whose centers are inside, in the scorer’s pixel convention', () => {
    // Edges at .2/.7 keep clear of pixel centers (.5): columns 32…63, rows 40…50.
    const mask = rasterizeOutlines(glyph(rect(32.2, 40.2, 63.7, 50.7)))
    expect(mask).toHaveLength(N * N)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        expect(mask[y * N + x], `${x},${y}`).toBe(x >= 32 && x <= 63 && y >= 40 && y <= 50 ? 1 : 0)
      }
    }
    // A user-ink sample and a mask pixel mean the same place.
    const inside = { x: 45.9 / N, y: 45.1 / N }
    const cell = rasterizePoints([inside], N).indexOf(1)
    expect(mask[cell]).toBe(1)
  })

  it('pixel count ≈ area, also for a rotated square', () => {
    const c = 64
    const h = 25
    const rotated = [0, 1, 2, 3].map((k): [number, number] => {
      const a = Math.PI / 6 + (k * Math.PI) / 2
      return [c + h * Math.SQRT2 * Math.cos(a), c + h * Math.SQRT2 * Math.sin(a)]
    })
    for (const d of [rect(20.3, 30.3, 70.3, 80.3), path(rotated)]) {
      const area = (2 * h) ** 2
      expect(Math.abs(count(rasterizeOutlines(glyph(d))) - area) / area).toBeLessThan(0.02)
    }
  })

  it('fills each stroke with the nonzero rule and unions the strokes', () => {
    const a = rect(20.2, 20.2, 60.2, 60.2) // 40 × 40 pixels
    const b = rect(40.2, 40.2, 80.2, 80.2)
    const union = 2 * 40 * 40 - 20 * 20
    // Overlapping subpaths drawn the same way are not a hole (they would be with even-odd).
    expect(count(rasterizeOutlines(glyph(`${a} ${b}`)))).toBe(union)
    expect(count(rasterizeOutlines(glyph(`${a} ${a}`)))).toBe(40 * 40)
    // A counter-wound subpath is a hole, as in SVG.
    expect(count(rasterizeOutlines(glyph(`${a} ${rect(30.2, 30.2, 50.2, 50.2, true)}`)))).toBe(40 * 40 - 20 * 20)
    // Separate strokes never cut holes into each other, whatever their direction.
    expect(count(rasterizeOutlines(glyph(a, rect(40.2, 40.2, 80.2, 80.2, true))))).toBe(union)
  })

  it('clips shapes that leave the grid and honours the size argument', () => {
    expect(count(rasterizeOutlines(glyph(rect(-50, -50, N + 50, N + 50))))).toBe(N * N)
    expect(count(rasterizeOutlines(glyph(rect(-50, 10.2, 20.2, 20.2))))).toBe(20 * 10)
    const small = rasterizeOutlines(glyph(rect(32.2, 32.2, 64.2, 64.2)), 64)
    expect(small).toHaveLength(64 * 64)
    expect(count(small)).toBe(16 * 16)
  })

  it.each(TEST_CHARS.map((c) => c.char))('%s: outlines, medians and the transform agree', async (char) => {
    const data = (await getStrokeData(char))!
    const mask = rasterizeOutlines(data)
    // Measured 0.09 (永) … 0.15 (國, 謝).
    const fraction = count(mask) / (N * N)
    expect(fraction).toBeGreaterThan(0.05)
    expect(fraction).toBeLessThan(0.25)

    // Nothing outside the em square's place in the box.
    const lo = Math.floor(sourceToBox(0, 900).x * N)
    const hi = Math.ceil(sourceToBox(1024, -124).x * N)
    mask.forEach((v, i) => {
      if (!v) return
      expect(i % N).toBeGreaterThanOrEqual(lo)
      expect(i % N).toBeLessThan(hi)
      expect(Math.floor(i / N)).toBeGreaterThanOrEqual(lo)
      expect(Math.floor(i / N)).toBeLessThan(hi)
    })

    // Every median runs inside its outline: sample it every half pixel, look the samples up in the
    // mask the way user ink is looked up. Measured: all samples hit, except the last ~1 px of one
    // 謝 hook whose median tip pokes past the outline (95.1% of that median).
    let total = 0
    let hits = 0
    for (const median of data.medians) {
      const samples = resample(
        median.map(([x, y]) => sourceToBox(x, y)),
        0.5 / N,
      )
      const onInk = rasterizePoints(samples, N)
      let strokeHits = 0
      for (const p of samples) strokeHits += mask[Math.floor(p.y * N) * N + Math.floor(p.x * N)]
      expect(onInk.every((v, i) => !v || mask[i])).toBe(strokeHits === samples.length)
      expect(strokeHits / samples.length).toBeGreaterThanOrEqual(0.9)
      total += samples.length
      hits += strokeHits
    }
    expect(hits / total).toBeGreaterThanOrEqual(0.98)
  })
})
