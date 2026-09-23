import { describe, expect, it } from 'vitest'
import { extendStart, MEDIAN_STROKE_WIDTH, medianPath } from './medianPath'
import { parseStrokeData } from './strokeData'
import type { SourcePoint } from './types'

const bundled = import.meta.glob<unknown>('../data/strokes/*.json', { eager: true, import: 'default' })

/** Points along an outline (absolute M/L/Q/C/Z only, as in the dataset), curves sampled finely. */
function outlinePoints(d: string): SourcePoint[] {
  const tokens = d.trim().split(/[\s,]+/)
  const points: SourcePoint[] = []
  let i = 0
  let cur: SourcePoint = [0, 0]
  let start: SourcePoint = [0, 0]
  const num = () => Number(tokens[i++])
  const pt = (): SourcePoint => [num(), num()]
  const sample = (f: (s: number) => SourcePoint) => {
    for (let k = 1; k <= 24; k++) points.push(f(k / 24))
  }
  while (i < tokens.length) {
    const cmd = tokens[i++]
    const p0 = cur
    if (cmd === 'M') {
      cur = start = pt()
      points.push(cur)
    } else if (cmd === 'L') {
      const p = pt()
      sample((s) => [p0[0] + (p[0] - p0[0]) * s, p0[1] + (p[1] - p0[1]) * s])
      cur = p
    } else if (cmd === 'Q') {
      const c = pt()
      const p = pt()
      sample((s) => {
        const u = 1 - s
        return [u * u * p0[0] + 2 * u * s * c[0] + s * s * p[0], u * u * p0[1] + 2 * u * s * c[1] + s * s * p[1]]
      })
      cur = p
    } else if (cmd === 'C') {
      const c1 = pt()
      const c2 = pt()
      const p = pt()
      sample((s) => {
        const u = 1 - s
        const a = u * u * u
        const b = 3 * u * u * s
        const c = 3 * u * s * s
        const e = s * s * s
        return [a * p0[0] + b * c1[0] + c * c2[0] + e * p[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p[1]]
      })
      cur = p
    } else if (cmd === 'Z') {
      cur = start
    } else {
      throw new Error(`unexpected path command ${cmd}`)
    }
  }
  return points
}

function distanceToPolyline(p: SourcePoint, line: readonly SourcePoint[]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const [bx, by] = line[i]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const s = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(p[0] - ax - s * dx, p[1] - ay - s * dy))
  }
  return best
}

function parsePathPoints(d: string): SourcePoint[] {
  return d.split(/\s*[ML]\s*/).filter(Boolean).map((pair) => pair.split(' ').map(Number) as unknown as SourcePoint)
}

describe('extendStart', () => {
  it('continues the first segment backwards', () => {
    expect(extendStart([[10, 0], [20, 0]], 5)).toEqual([[5, 0], [10, 0], [20, 0]])
  })

  it('skips repeated first points to find a direction', () => {
    expect(extendStart([[0, 0], [0, 0], [0, 10]], 3)).toEqual([[0, -3], [0, 0], [0, 0], [0, 10]])
  })

  it('leaves a degenerate median alone', () => {
    expect(extendStart([[4, 4], [4, 4]], 3)).toEqual([[4, 4], [4, 4]])
  })
})

describe('medianPath', () => {
  it('writes the extended median and its length', () => {
    const path = medianPath([[100, 0], [400, 0], [400, 400]], 200)
    expect(path.d).toBe('M0 0 L100 0 L400 0 L400 400')
    expect(path.length).toBe(800)
    expect(path.lead).toBe(100)
  })

  it('has no lead for a median it cannot extend', () => {
    const path = medianPath([[4, 4], [4, 4]])
    expect(path.length).toBe(0)
    expect(path.lead).toBe(0)
  })

  it('reports the length of the path it writes (rounded coordinates)', () => {
    const path = medianPath([[0.123, 0.456], [333.333, 777.777]])
    expect(path.length).toBeCloseTo(
      parsePathPoints(path.d).reduce((sum, p, i, all) => (i === 0 ? 0 : sum + Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1])), 0),
      9,
    )
  })

  it('is wide enough to cover every bundled stroke outline', () => {
    const files = Object.entries(bundled)
    expect(files.length).toBeGreaterThanOrEqual(5)
    let worst = 0
    for (const [file, json] of files) {
      const data = parseStrokeData(json)
      expect(data, file).not.toBeNull()
      data!.strokes.forEach((outline, i) => {
        const line = parsePathPoints(medianPath(data!.medians[i]).d)
        for (const p of outlinePoints(outline)) worst = Math.max(worst, distanceToPolyline(p, line))
      })
    }
    // Measured: ≈ 84 units. A round-capped line of width w covers everything within w/2 of it.
    expect(worst).toBeGreaterThan(60)
    expect(worst).toBeLessThan(MEDIAN_STROKE_WIDTH / 2 - 10)
  })
})
