import type { Vec } from './types'

/** Pure geometry helpers for scoring. Coordinates are box units; grids are square, row-major. */

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function polylineLength(pts: readonly Vec[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** Points every `spacing` along the polyline, including both ends. A single point stays one sample. */
export function resample(pts: readonly Vec[], spacing: number): Vec[] {
  if (pts.length === 0) return []
  const out: Vec[] = [{ x: pts[0].x, y: pts[0].y }]
  let carry = 0 // distance travelled since the last emitted sample
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg === 0) continue
    let t = spacing - carry
    while (t <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg })
      t += spacing
    }
    carry = seg - (t - spacing)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (tail.x !== last.x || tail.y !== last.y) out.push({ x: last.x, y: last.y })
  return out
}

export function boundsOf(pts: readonly Vec[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Uniform scale + translation mapping `from` onto `to` (centers matched, larger side matched).
 * Scale is clamped so a tiny scribble is not blown up into a full-size character.
 */
export function alignmentScale(from: Bounds, to: Bounds, maxScale = 2): number {
  const fromSide = Math.max(from.maxX - from.minX, from.maxY - from.minY)
  const toSide = Math.max(to.maxX - to.minX, to.maxY - to.minY)
  if (fromSide <= 0 || toSide <= 0) return 1
  return Math.min(maxScale, Math.max(1 / maxScale, toSide / fromSide))
}

export function align(pts: readonly Vec[], from: Bounds, to: Bounds, scale: number): Vec[] {
  const fx = (from.minX + from.maxX) / 2
  const fy = (from.minY + from.maxY) / 2
  const tx = (to.minX + to.maxX) / 2
  const ty = (to.minY + to.maxY) / 2
  return pts.map((p) => ({ x: tx + (p.x - fx) * scale, y: ty + (p.y - fy) * scale }))
}

/** Rasterize polylines with a round pen of `width` (box units) onto an n×n grid. */
export function rasterizePolylines(lines: readonly (readonly Vec[])[], n: number, width: number): Uint8Array {
  const grid = new Uint8Array(n * n)
  const r = (width / 2) * n
  for (const line of lines) {
    if (line.length === 0) continue
    const pts = line.length === 1 ? [line[0], line[0]] : line
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x * n
      const ay = pts[i - 1].y * n
      const bx = pts[i].x * n
      const by = pts[i].y * n
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
      const x1 = Math.min(n - 1, Math.ceil(Math.max(ax, bx) + r))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r))
      const y1 = Math.min(n - 1, Math.ceil(Math.max(ay, by) + r))
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5
          const py = y + 0.5
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
          const ex = px - (ax + t * dx)
          const ey = py - (ay + t * dy)
          if (ex * ex + ey * ey <= r * r) grid[y * n + x] = 1
        }
      }
    }
  }
  return grid
}

/** Mark the cell under each point (points outside the box are ignored). */
export function rasterizePoints(pts: readonly Vec[], n: number): Uint8Array {
  const grid = new Uint8Array(n * n)
  for (const p of pts) {
    if (p.x < 0 || p.y < 0 || p.x >= 1 || p.y >= 1) continue
    grid[Math.floor(p.y * n) * n + Math.floor(p.x * n)] = 1
  }
  return grid
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance in cells from each
 * cell to the nearest set cell. All Infinity when the grid is empty.
 */
export function distanceTransform(grid: Uint8Array, n: number): Float32Array {
  const out = new Float32Array(n * n)
  if (!grid.includes(1)) return out.fill(Infinity)
  const INF = 1e20
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const tmp = new Float64Array(n * n)
  // Columns, then rows.
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x] ? 0 : INF
    edt1d(f, n, d, v, z)
    for (let y = 0; y < n; y++) tmp[y * n + x] = d[y]
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = tmp[y * n + x]
    edt1d(f, n, d, v, z)
    for (let x = 0; x < n; x++) out[y * n + x] = Math.sqrt(d[x])
  }
  return out
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Distance (box units) from a point to the nearest set cell of the grid behind `dt`. */
export function distanceAt(dt: Float32Array, n: number, p: Vec): number {
  const cx = Math.min(n - 1, Math.max(0, Math.floor(p.x * n)))
  const cy = Math.min(n - 1, Math.max(0, Math.floor(p.y * n)))
  // Points outside the box: add the distance to the box edge.
  const ox = Math.max(0, -p.x, p.x - 1)
  const oy = Math.max(0, -p.y, p.y - 1)
  return dt[cy * n + cx] / n + Math.hypot(ox, oy)
}

/** Zhang–Suen thinning: 1-cell-wide 8-connected centerlines of the set cells. */
export function skeletonize(grid: Uint8Array, n: number): Uint8Array {
  const img = grid.slice()
  const remove: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      remove.length = 0
      for (let y = 1; y < n - 1; y++) {
        for (let x = 1; x < n - 1; x++) {
          const i = y * n + x
          if (!img[i]) continue
          const p2 = img[i - n]
          const p3 = img[i - n + 1]
          const p4 = img[i + 1]
          const p5 = img[i + n + 1]
          const p6 = img[i + n]
          const p7 = img[i + n - 1]
          const p8 = img[i - 1]
          const p9 = img[i - n - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a =
            (+(!p2 && p3) + +(!p3 && p4) + +(!p4 && p5) + +(!p5 && p6)) +
            (+(!p6 && p7) + +(!p7 && p8) + +(!p8 && p9) + +(!p9 && p2))
          if (a !== 1) continue
          if (step === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) {
            remove.push(i)
          }
        }
      }
      for (const i of remove) img[i] = 0
      if (remove.length > 0) changed = true
    }
  }
  return img
}

/** Centers of set cells as box-unit points. */
export function cellCenters(grid: Uint8Array, n: number): Vec[] {
  const out: Vec[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (grid[y * n + x]) out.push({ x: (x + 0.5) / n, y: (y + 0.5) / n })
  }
  return out
}

/**
 * Length of an 8-connected 1-cell-wide skeleton, box units. A digital line at angle θ has
 * 1/max(|cos θ|, |sin θ|) length per cell; averaged over θ that is (4/π)·ln(1+√2) ≈ 1.122.
 */
export const SKELETON_LENGTH_PER_CELL = (4 / Math.PI) * Math.log(1 + Math.SQRT2)

// ── Orientation-aware matching ──────────────────────────────────────────────
// Directions are undirected (a stroke drawn either way has the same orientation), stored as
// doubled-angle unit vectors (cos 2θ, sin 2θ): their dot product is cos 2Δθ. (0, 0) = unknown,
// which matches any direction (e.g. a lone dot).

/** Doubled-angle orientation of each point of a resampled polyline, from its neighbours. */
export function polylineOrientations(pts: readonly Vec[]): Float32Array {
  const out = new Float32Array(pts.length * 2)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 2)]
    const b = pts[Math.min(pts.length - 1, i + 2)]
    setOrientation(out, i, b.x - a.x, b.y - a.y)
  }
  return out
}

/** Principal orientation of the skeleton around each center (PCA over a (2r+1)² window). */
export function skeletonOrientations(skeleton: Uint8Array, n: number, centers: readonly Vec[], r = 3): Float32Array {
  const out = new Float32Array(centers.length * 2)
  centers.forEach((c, i) => {
    const cx = Math.floor(c.x * n)
    const cy = Math.floor(c.y * n)
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= n || y >= n || !skeleton[y * n + x]) continue
        sxx += dx * dx
        syy += dy * dy
        sxy += dx * dy
      }
    }
    // Doubled angle of the principal axis: 2θ = atan2(2·sxy, sxx − syy).
    const len = Math.hypot(sxx - syy, 2 * sxy)
    if (len > 0) {
      out[i * 2] = (sxx - syy) / len
      out[i * 2 + 1] = (2 * sxy) / len
    }
  })
  return out
}

function setOrientation(out: Float32Array, i: number, dx: number, dy: number): void {
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return
  out[i * 2] = (dx * dx - dy * dy) / len2
  out[i * 2 + 1] = (2 * dx * dy) / len2
}

/** Points bucketed by grid cell (CSR layout) for neighbourhood queries. */
export interface PointIndex {
  n: number
  start: Int32Array
  items: Int32Array
}

export function indexPoints(pts: readonly Vec[], n: number): PointIndex {
  const cellOf = (p: Vec) =>
    Math.min(n - 1, Math.max(0, Math.floor(p.y * n))) * n + Math.min(n - 1, Math.max(0, Math.floor(p.x * n)))
  const start = new Int32Array(n * n + 1)
  for (const p of pts) start[cellOf(p) + 1]++
  for (let i = 0; i < n * n; i++) start[i + 1] += start[i]
  const fill = start.slice(0, n * n)
  const items = new Int32Array(pts.length)
  pts.forEach((p, i) => {
    items[fill[cellOf(p)]++] = i
  })
  return { n, start, items }
}

/**
 * Fraction of `src` points that have a `dst` point within `tol` whose orientation differs by
 * less than the angle encoded in `minSimilarity` (= cos 2Δθ).
 */
export function matchFraction(
  src: readonly Vec[],
  srcDir: Float32Array,
  dst: readonly Vec[],
  dstDir: Float32Array,
  index: PointIndex,
  tol: number,
  minSimilarity: number,
): number {
  if (src.length === 0) return 0
  const n = index.n
  const reach = Math.ceil(tol * n)
  const tol2 = tol * tol
  let matched = 0
  for (let i = 0; i < src.length; i++) {
    const p = src[i]
    const sc = srcDir[i * 2]
    const ss = srcDir[i * 2 + 1]
    const cx = Math.floor(p.x * n)
    const cy = Math.floor(p.y * n)
    let found = false
    for (let y = Math.max(0, cy - reach); y <= Math.min(n - 1, cy + reach) && !found; y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(n - 1, cx + reach) && !found; x++) {
        const cell = y * n + x
        for (let k = index.start[cell]; k < index.start[cell + 1]; k++) {
          const j = index.items[k]
          const q = dst[j]
          const ddx = q.x - p.x
          const ddy = q.y - p.y
          if (ddx * ddx + ddy * ddy > tol2) continue
          const dc = dstDir[j * 2]
          const ds = dstDir[j * 2 + 1]
          const unknown = (sc === 0 && ss === 0) || (dc === 0 && ds === 0)
          if (unknown || sc * dc + ss * ds >= minSimilarity) {
            found = true
            break
          }
        }
      }
    }
    if (found) matched++
  }
  return matched / src.length
}

/** Nearest-neighbour resample of a square grid to n×n. */
export function resampleGrid(grid: Uint8Array, from: number, n: number): Uint8Array {
  if (from === n) return grid
  const out = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) {
    const sy = Math.min(from - 1, Math.floor(((y + 0.5) * from) / n))
    for (let x = 0; x < n; x++) {
      const sx = Math.min(from - 1, Math.floor(((x + 0.5) * from) / n))
      out[y * n + x] = grid[sy * from + sx]
    }
  }
  return out
}
