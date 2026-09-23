import type { Point, Stroke } from '../types'
import { clearCanvas, type Renderer, type RenderStyle } from './Renderer'

/**
 * Renderer A — quadratic Bézier through segment midpoints, constant width, round caps.
 *
 * Segment k (1 ≤ k ≤ n-2) runs from mid(p[k-1], p[k]) (p[0] for k = 1) to mid(p[k], p[k+1]) with
 * p[k] as control point. A segment is final once p[k+1] exists, so live drawing is incremental:
 * each frame strokes only newly-final segments onto the persistent live layer (O(new points)),
 * and redraws the short unsettled tail (+ predicted points) on the tail layer.
 */
export class QuadRenderer implements Renderer {
  readonly kind = 'quad'
  /** Segments 1..drawn are already on the live layer. */
  private drawn = 0

  beginLive(): void {
    this.drawn = 0
  }

  drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, size: number, style: RenderStyle): void {
    const pts = stroke.points
    const n = pts.length
    if (n === 0) return
    applyStyle(ctx, style, size)
    if (n === 1) {
      dot(ctx, pts[0], size, style)
      return
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x * size, pts[0].y * size)
    curveThrough(ctx, pts, 1, n - 2, size)
    ctx.lineTo(pts[n - 1].x * size, pts[n - 1].y * size)
    ctx.stroke()
  }

  drawLive(
    live: CanvasRenderingContext2D,
    tail: CanvasRenderingContext2D,
    stroke: Stroke,
    predicted: readonly Point[],
    size: number,
    style: RenderStyle,
  ): void {
    const pts = stroke.points
    const n = pts.length
    const lastFinal = n - 2

    if (lastFinal > this.drawn) {
      applyStyle(live, style, size)
      live.beginPath()
      moveToSegmentStart(live, pts, this.drawn + 1, size)
      curveThrough(live, pts, this.drawn + 1, lastFinal, size)
      live.stroke()
      this.drawn = lastFinal
    }

    clearCanvas(tail)
    applyStyle(tail, style, size)
    if (n === 1 && predicted.length === 0) {
      dot(tail, pts[0], size, style)
      return
    }
    tail.beginPath()
    moveToSegmentStart(tail, pts, n - 1, size)
    tail.lineTo(pts[n - 1].x * size, pts[n - 1].y * size)
    for (const p of predicted) tail.lineTo(p.x * size, p.y * size)
    tail.stroke()
  }
}

function applyStyle(ctx: CanvasRenderingContext2D, style: RenderStyle, size: number): void {
  ctx.lineWidth = style.width * size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = style.color
  ctx.fillStyle = style.color
}

function moveToSegmentStart(ctx: CanvasRenderingContext2D, pts: readonly Point[], k: number, size: number): void {
  if (k <= 1) {
    ctx.moveTo(pts[0].x * size, pts[0].y * size)
  } else {
    const a = pts[k - 1]
    const b = pts[k]
    ctx.moveTo(((a.x + b.x) / 2) * size, ((a.y + b.y) / 2) * size)
  }
}

function curveThrough(ctx: CanvasRenderingContext2D, pts: readonly Point[], from: number, to: number, size: number): void {
  for (let k = from; k <= to; k++) {
    const c = pts[k]
    const d = pts[k + 1]
    ctx.quadraticCurveTo(c.x * size, c.y * size, ((c.x + d.x) / 2) * size, ((c.y + d.y) / 2) * size)
  }
}

function dot(ctx: CanvasRenderingContext2D, p: Point, size: number, style: RenderStyle): void {
  ctx.beginPath()
  ctx.arc(p.x * size, p.y * size, (style.width * size) / 2, 0, Math.PI * 2)
  ctx.fill()
}
