import type { SourcePoint } from './types'

/**
 * Minimal SVG path-data parser for stroke outlines: flattens a path into polygons, one per subpath,
 * each implicitly closed (as SVG fills them). Supports M L H V Q C Z, absolute and relative — the
 * dataset only uses absolute M L Q C Z — and throws on anything else (A, S, T…) rather than filling
 * a wrong shape.
 */

/**
 * Max distance (source units) between a curve and its flattened polyline. One source unit is
 * ≈ 0.1 px of the 128² scoring grid, so flattening never shows in a raster.
 */
export const FLATTEN_TOLERANCE = 0.25

/** Cap per curve segment, so hostile control points cannot explode the point count. */
const MAX_CURVE_SEGMENTS = 256

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y
const SEPARATOR = /[\s,]/

/** Path data → numbers and single-letter commands. Throws on anything that is neither. */
function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = []
  let i = 0
  while (i < d.length) {
    const ch = d[i]
    if (SEPARATOR.test(ch)) {
      i++
    } else if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      tokens.push(ch)
      i++
    } else {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(d)
      if (!m) throw new Error(`Invalid SVG path data at ${i}: "${d.slice(i, i + 12)}"`)
      tokens.push(Number(m[0]))
      i = NUMBER.lastIndex
    }
  }
  return tokens
}

/** Flattens SVG path data into closed polygons (source coordinates), one per non-degenerate subpath. */
export function pathToPolygons(d: string, tolerance = FLATTEN_TOLERANCE): SourcePoint[][] {
  const tokens = tokenize(d)
  if (tokens.length > 0 && tokens[0] !== 'M' && tokens[0] !== 'm') {
    throw new Error('SVG path must start with a moveto command')
  }
  const polygons: SourcePoint[][] = []
  let ring: SourcePoint[] | null = null
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let cmd = ''
  let i = 0

  const num = (): number => {
    const t = tokens[i++]
    if (typeof t !== 'number') throw new Error(`SVG path: command "${cmd}" is missing a number`)
    return t
  }
  const finish = () => {
    if (!ring) return
    const last = ring[ring.length - 1]
    if (ring.length > 1 && last[0] === ring[0][0] && last[1] === ring[0][1]) ring.pop()
    if (ring.length >= 3) polygons.push(ring)
    ring = null
  }
  // After Z without M, the next subpath starts at the previous subpath's start (SVG spec).
  const current = (): SourcePoint[] => (ring ??= [[startX, startY]])
  const lineTo = (nx: number, ny: number) => {
    current().push([nx, ny])
    x = nx
    y = ny
  }

  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === 'string') {
      if (!'MmLlHhVvQqCcZz'.includes(t)) throw new Error(`Unsupported SVG path command "${t}"`)
      cmd = t
      i++
    } else if (cmd === 'Z' || cmd === 'z') {
      throw new Error('SVG path: numbers after closepath')
    }
    // A number here repeats the previous command (implicit repetition).
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd) {
      case 'M':
      case 'm': {
        finish()
        x = ox + num()
        y = oy + num()
        startX = x
        startY = y
        ring = [[x, y]]
        // Extra coordinate pairs after a moveto are linetos.
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L':
      case 'l': {
        const nx = ox + num()
        lineTo(nx, oy + num())
        break
      }
      case 'H':
      case 'h':
        lineTo(ox + num(), y)
        break
      case 'V':
      case 'v':
        lineTo(x, oy + num())
        break
      case 'Q':
      case 'q': {
        const x1 = ox + num()
        const y1 = oy + num()
        const x2 = ox + num()
        const y2 = oy + num()
        flattenQuad(current(), x, y, x1, y1, x2, y2, tolerance)
        x = x2
        y = y2
        break
      }
      case 'C':
      case 'c': {
        const x1 = ox + num()
        const y1 = oy + num()
        const x2 = ox + num()
        const y2 = oy + num()
        const x3 = ox + num()
        const y3 = oy + num()
        flattenCubic(current(), x, y, x1, y1, x2, y2, x3, y3, tolerance)
        x = x3
        y = y3
        break
      }
      case 'Z':
      case 'z':
        finish()
        x = startX
        y = startY
        break
    }
  }
  finish()
  return polygons
}

// Uniform subdivision with the segment count from Wang's formula: n segments keep a degree-d
// Bézier within `tol` of its chords when n ≥ √(d(d−1)·M / (8·tol)), M = max |Pᵢ − 2Pᵢ₊₁ + Pᵢ₊₂|.

function segmentCount(factor: number, tol: number): number {
  return Math.min(MAX_CURVE_SEGMENTS, Math.max(1, Math.ceil(Math.sqrt(factor / tol))))
}

function flattenQuad(out: SourcePoint[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, tol: number) {
  const m = Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2)
  const n = segmentCount(m / 4, tol)
  for (let k = 1; k < n; k++) {
    const t = k / n
    const mt = 1 - t
    out.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x2, mt * mt * y0 + 2 * mt * t * y1 + t * t * y2])
  }
  out.push([x2, y2])
}

function flattenCubic(
  out: SourcePoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
) {
  const m = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3))
  const n = segmentCount((3 * m) / 4, tol)
  for (let k = 1; k < n; k++) {
    const t = k / n
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const e = t * t * t
    out.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3])
  }
  out.push([x3, y3])
}
