import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../test/fixtures/testChars'
import { fixtureLoader as getStrokeData } from '../test/fixtures/strokes'
import { FLATTEN_TOLERANCE, pathToPolygons } from './svgPath'
import type { SourcePoint } from './types'

/** Distance from a point to a closed polygon's boundary. */
function distanceToRing(ring: readonly SourcePoint[], [px, py]: SourcePoint): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % ring.length]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return best
}

const quad = (t: number, p0: number, p1: number, p2: number) => (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
const cubic = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3

describe('pathToPolygons', () => {
  it('parses straight-edged polygons', () => {
    expect(pathToPolygons('M 0 0 L 10 0 L 10 10 L 0 10 Z')).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ])
    // An explicit return to the start is the same polygon as an implicit one.
    expect(pathToPolygons('M 0 0 L 10 0 L 0 10 L 0 0 Z')).toEqual(pathToPolygons('M 0 0 L 10 0 L 0 10 Z'))
    // Open subpaths are filled as if closed.
    expect(pathToPolygons('M 0 0 L 10 0 L 0 10')).toEqual(pathToPolygons('M 0 0 L 10 0 L 0 10 Z'))
  })

  it('handles implicit repetition, commas and compact number syntax', () => {
    const triangle = [
      [0, 0],
      [10, 0],
      [10, -10],
    ]
    expect(pathToPolygons('M0,0 10,0 10-10z')).toEqual([triangle])
    expect(pathToPolygons('M 0 0 L 10 0 10 -10 Z')).toEqual([triangle])
    expect(pathToPolygons('M.5.5L1e1,.5 5 5Z')).toEqual([
      [
        [0.5, 0.5],
        [10, 0.5],
        [5, 5],
      ],
    ])
  })

  it('supports relative commands and H/V', () => {
    const square = [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]
    expect(pathToPolygons('M 10 10 H 20 V 20 H 10 Z')).toEqual([square])
    expect(pathToPolygons('m 10 10 h 10 v 10 h -10 z')).toEqual([square])
    expect(pathToPolygons('m 10 10 l 10 0 0 10 -10 0 z')).toEqual([square])
    // Extra pairs after a relative moveto are relative linetos.
    expect(pathToPolygons('m 10 10 10 0 0 10 -10 0 z')).toEqual([square])
  })

  it('splits subpaths; after Z the next subpath starts at the previous start', () => {
    expect(pathToPolygons('M 0 0 L 10 0 L 10 10 Z M 20 20 L 30 20 L 30 30 Z')).toHaveLength(2)
    expect(pathToPolygons('M 0 0 L 10 0 L 10 10 Z L 0 10 L -10 10 Z')[1]).toEqual([
      [0, 0],
      [0, 10],
      [-10, 10],
    ])
    expect(pathToPolygons('M 5 5 L 10 5 L 10 10 z m 20 0 l 10 0 l 0 10 z')[1]).toEqual([
      [25, 5],
      [35, 5],
      [35, 15],
    ])
  })

  it('drops subpaths with no area to fill', () => {
    expect(pathToPolygons('M 0 0 Z M 5 5 L 6 6 Z')).toEqual([])
    expect(pathToPolygons('')).toEqual([])
  })

  it('flattens Q with exact endpoints and stays within the tolerance of the curve', () => {
    const [ring] = pathToPolygons('M 0 0 Q 50 100 100 0 Z')
    expect(ring[0]).toEqual([0, 0])
    expect(ring[ring.length - 1]).toEqual([100, 0])
    expect(distanceToRing(ring, [50, 50])).toBeLessThanOrEqual(FLATTEN_TOLERANCE) // the curve's midpoint
    for (let t = 0; t <= 1; t += 1 / 64) {
      expect(distanceToRing(ring, [quad(t, 0, 50, 100), quad(t, 0, 100, 0)])).toBeLessThanOrEqual(FLATTEN_TOLERANCE)
    }
    expect(ring.length).toBeLessThan(40) // fine, not wasteful
  })

  it('flattens C with exact endpoints and stays within the tolerance of the curve', () => {
    const [ring] = pathToPolygons('M 0 0 C 0 100 100 100 100 0 Z')
    expect(ring[0]).toEqual([0, 0])
    expect(ring[ring.length - 1]).toEqual([100, 0])
    expect(distanceToRing(ring, [50, 75])).toBeLessThanOrEqual(FLATTEN_TOLERANCE)
    for (let t = 0; t <= 1; t += 1 / 64) {
      const p: SourcePoint = [cubic(t, 0, 0, 100, 100), cubic(t, 0, 100, 100, 0)]
      expect(distanceToRing(ring, p)).toBeLessThanOrEqual(FLATTEN_TOLERANCE)
    }
  })

  it('relative curves are relative to the current point', () => {
    expect(pathToPolygons('M 10 10 q 50 100 100 0 z')).toEqual(pathToPolygons('M 10 10 Q 60 110 110 10 Z'))
    expect(pathToPolygons('M 10 10 c 0 100 100 100 100 0 z')).toEqual(pathToPolygons('M 10 10 C 10 110 110 110 110 10 Z'))
  })

  it('throws on unsupported commands and malformed data instead of guessing', () => {
    expect(() => pathToPolygons('M 0 0 A 5 5 0 0 1 10 10 Z')).toThrow(/Unsupported SVG path command "A"/)
    expect(() => pathToPolygons('M 0 0 S 10 10 20 0 Z')).toThrow(/"S"/)
    expect(() => pathToPolygons('M 0 0 T 20 0 Z')).toThrow(/"T"/)
    for (const d of ['L 0 0 L 1 1 Z', '10 10 L 1 1', 'M 0 0 L 1', 'M 0 0 L 1 1 Z 5 5', 'M 0 0 L 1 # 1', 'M 0 0 Q 1 1 Z']) {
      expect(() => pathToPolygons(d), d).toThrow()
    }
  })

  it('every stroke of the bundled characters becomes closed polygons inside the dataset’s extent', async () => {
    for (const { char } of TEST_CHARS) {
      const data = await getStrokeData(char)
      for (const d of data!.strokes) {
        const polygons = pathToPolygons(d)
        expect(polygons.length, char).toBeGreaterThanOrEqual(1)
        for (const ring of polygons) {
          expect(ring.length).toBeGreaterThanOrEqual(3)
          for (const [x, y] of ring) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
            // Observed extent of the 5 characters' path data: x 41…961, y −49…856.
            expect(x).toBeGreaterThanOrEqual(41)
            expect(x).toBeLessThanOrEqual(961)
            expect(y).toBeGreaterThanOrEqual(-49)
            expect(y).toBeLessThanOrEqual(856)
          }
        }
      }
    }
  })
})
