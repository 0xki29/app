import { describe, expect, it } from 'vitest'
import {
  alignmentScale,
  cellCenters,
  distanceAt,
  distanceTransform,
  indexPoints,
  matchFraction,
  polylineLength,
  polylineOrientations,
  rasterizePolylines,
  resample,
  skeletonize,
  SKELETON_LENGTH_PER_CELL,
} from './geometry'

describe('geometry', () => {
  it('resample keeps endpoints and even spacing', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.25)
    expect(pts.map((p) => p.x)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(resample([{ x: 0.3, y: 0.3 }], 0.1)).toEqual([{ x: 0.3, y: 0.3 }])
    expect(resample([], 0.1)).toEqual([])
  })

  it('distance transform is exact on a small grid', () => {
    const n = 5
    const g = new Uint8Array(n * n)
    g[2 * n + 2] = 1
    const dt = distanceTransform(g, n)
    expect(dt[2 * n + 2]).toBe(0)
    expect(dt[2 * n + 4]).toBeCloseTo(2)
    expect(dt[0]).toBeCloseTo(Math.hypot(2, 2))
    expect(distanceTransform(new Uint8Array(4), 2)[0]).toBe(Infinity)
  })

  it('distanceAt adds the distance to the box edge for outside points', () => {
    const n = 4
    const g = new Uint8Array(n * n).fill(1)
    const dt = distanceTransform(g, n)
    expect(distanceAt(dt, n, { x: 0.5, y: 0.5 })).toBe(0)
    expect(distanceAt(dt, n, { x: 1.2, y: 0.5 })).toBeCloseTo(0.2)
  })

  it('skeleton length approximates the centerline length of thick strokes', () => {
    const n = 128
    for (const line of [
      [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
      [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.75 }],
      [{ x: 0.3, y: 0.2 }, { x: 0.3, y: 0.7 }, { x: 0.75, y: 0.7 }],
    ]) {
      const skeleton = skeletonize(rasterizePolylines([line], n, 0.07), n)
      const estimate = (cellCenters(skeleton, n).length * SKELETON_LENGTH_PER_CELL) / n
      const truth = polylineLength(line)
      expect(Math.abs(estimate - truth) / truth).toBeLessThan(0.15)
    }
  })

  it('a sample without direction matches only on the reference side', () => {
    const minSim = Math.cos((60 * Math.PI) / 180)
    const line = resample([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], 0.01)
    const lineDir = polylineOrientations(line)
    const tap = [{ x: 0.5, y: 0.5 }]
    const tapDir = polylineOrientations(tap)
    expect([...tapDir]).toEqual([0, 0])
    const along = resample([{ x: 0.45, y: 0.51 }, { x: 0.55, y: 0.51 }], 0.01)
    const across = resample([{ x: 0.5, y: 0.45 }, { x: 0.5, y: 0.55 }], 0.01)
    const at = (pts: { x: number; y: number }[]) => indexPoints(pts, 128)

    // Ink → reference (precision): a tap on a stroke does not run along it; ink along it does.
    expect(matchFraction(tap, tapDir, line, lineDir, at(line), 0.045, minSim, 'dst')).toBe(0)
    expect(matchFraction(along, polylineOrientations(along), line, lineDir, at(line), 0.045, minSim, 'dst')).toBe(1)
    expect(matchFraction(across, polylineOrientations(across), line, lineDir, at(line), 0.045, minSim, 'dst')).toBeLessThan(0.3)
    // Reference → ink (coverage): a tap covers no part of a stroke.
    expect(matchFraction(line, lineDir, tap, tapDir, at(tap), 0.045, minSim, 'src')).toBe(0)
    // A reference point without direction (a lone dot) is matched by ink of any direction, a tap included.
    expect(matchFraction(tap, tapDir, tap, tapDir, at(tap), 0.045, minSim, 'dst')).toBe(1)
    expect(matchFraction(across, polylineOrientations(across), tap, tapDir, at(tap), 0.1, minSim, 'dst')).toBe(1)
    expect(matchFraction(tap, tapDir, across, polylineOrientations(across), at(across), 0.1, minSim, 'src')).toBe(1)
  })

  it('alignment scale is clamped', () => {
    const tiny = { minX: 0.5, minY: 0.5, maxX: 0.51, maxY: 0.51 }
    const full = { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 }
    expect(alignmentScale(tiny, full)).toBe(2)
    expect(alignmentScale(full, full)).toBe(1)
  })
})
