import { GRID_SIZE } from '../handwriting/scoring/config'
import { pathToPolygons } from './svgPath'
import { sourceToBox } from './transform'
import type { StrokeData } from './types'

/**
 * Fills a character's stroke outlines into a square binary mask — GlyphMask semantics: row-major,
 * 1 = ink — placed with sourceToBox, the same mapping as the on-screen glyph.
 *
 * Pixel (x, y) covers box [x/size, (x+1)/size) × [y/size, (y+1)/size) and is ink when its center
 * lies inside a stroke: the convention of the scorer's own rasters (geometry.ts), so a mask pixel
 * and a user-ink pixel mean the same place. Each stroke is filled with the nonzero rule (SVG's
 * default fill-rule) and the strokes are unioned, exactly like one `<path>` per stroke.
 */
export function rasterizeOutlines(data: StrokeData, size = GRID_SIZE): Uint8Array {
  const grid = new Uint8Array(size * size)
  // Reused across strokes and rows: edges as flat (x0, y0, x1, y1) in grid units, row crossings.
  const edges: number[] = []
  const xs: number[] = []
  const winds: number[] = []
  for (const d of data.strokes) {
    edges.length = 0
    let minY = Infinity
    let maxY = -Infinity
    for (const ring of pathToPolygons(d)) {
      let prev = sourceToBox(ring[ring.length - 1][0], ring[ring.length - 1][1])
      for (const [sx, sy] of ring) {
        const p = sourceToBox(sx, sy)
        edges.push(prev.x * size, prev.y * size, p.x * size, p.y * size)
        prev = p
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }
    if (edges.length > 0) fillNonzero(grid, size, edges, minY * size, maxY * size, xs, winds)
  }
  return grid
}

/** Scanline fill of one closed edge set, sampling at pixel centers, nonzero winding. */
function fillNonzero(
  grid: Uint8Array,
  size: number,
  edges: readonly number[],
  minY: number,
  maxY: number,
  xs: number[],
  winds: number[],
): void {
  // Rows whose center (row + 0.5) lies in [minY, maxY).
  const firstRow = Math.max(0, Math.ceil(minY - 0.5))
  const lastRow = Math.min(size - 1, Math.ceil(maxY - 0.5) - 1)
  for (let row = firstRow; row <= lastRow; row++) {
    const cy = row + 0.5
    xs.length = 0
    winds.length = 0
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = edges[e + 1]
      const y1 = edges[e + 3]
      // Half-open in y, so a vertex exactly on the scanline counts once and horizontals never.
      if ((y0 <= cy) === (y1 <= cy)) continue
      const x0 = edges[e]
      const x = x0 + ((cy - y0) * (edges[e + 2] - x0)) / (y1 - y0)
      // Insertion sort: a row of a stroke crosses only a handful of edges.
      let k = xs.length
      xs.push(x)
      winds.push(y1 > y0 ? 1 : -1)
      while (k > 0 && xs[k - 1] > x) {
        xs[k] = xs[k - 1]
        winds[k] = winds[k - 1]
        k--
      }
      xs[k] = x
      winds[k] = y1 > y0 ? 1 : -1
    }
    let winding = 0
    let spanStart = 0
    const base = row * size
    for (let k = 0; k < xs.length; k++) {
      const before = winding
      winding += winds[k]
      if (before === 0 && winding !== 0) {
        spanStart = xs[k]
      } else if (before !== 0 && winding === 0) {
        // Pixels whose center (col + 0.5) lies in [spanStart, xs[k]).
        const from = Math.max(0, Math.ceil(spanStart - 0.5))
        const to = Math.min(size, Math.ceil(xs[k] - 0.5))
        for (let col = from; col < to; col++) grid[base + col] = 1
      }
    }
  }
}
