import getStroke, { type StrokeOptions } from 'perfect-freehand'
import type { Point, PointerKind, Stroke } from '../types'
import { clearCanvas, type Renderer, type RenderStyle } from './Renderer'

/**
 * Renderer B — perfect-freehand: the stroke is a filled outline polygon whose width follows
 * pen pressure, or simulated pressure (velocity) for touch/mouse.
 *
 * Not incremental: the outline depends on the whole stroke, so each frame recomputes and
 * refills the current stroke on the live layer — O(points in this stroke) per frame. Committed
 * strokes are never redrawn while writing.
 */
export class FreehandRenderer implements Renderer {
  readonly kind = 'freehand'
  /** Pixel-space input for the live stroke, extended per frame instead of rebuilt. */
  private input: number[][] = []
  private inputStroke: Stroke | null = null
  private inputSize = 0

  beginLive(): void {
    this.inputStroke = null
  }

  drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, size: number, style: RenderStyle): void {
    const input = stroke.points.map((p) => [p.x * size, p.y * size, p.p])
    fillOutline(ctx, getStroke(input, options(style, size, stroke.pointerType, true)), style.color)
  }

  drawLive(
    live: CanvasRenderingContext2D,
    _tail: CanvasRenderingContext2D,
    stroke: Stroke,
    predicted: readonly Point[],
    size: number,
    style: RenderStyle,
  ): void {
    const input = this.liveInput(stroke, size)
    const settled = input.length
    for (const p of predicted) input.push([p.x * size, p.y * size, p.p])
    const outline = getStroke(input, options(style, size, stroke.pointerType, false))
    input.length = settled

    clearCanvas(live)
    fillOutline(live, outline, style.color)
  }

  private liveInput(stroke: Stroke, size: number): number[][] {
    if (this.inputStroke !== stroke || this.inputSize !== size) {
      this.input = []
      this.inputStroke = stroke
      this.inputSize = size
    }
    const pts = stroke.points
    for (let i = this.input.length; i < pts.length; i++) {
      const p = pts[i]
      this.input.push([p.x * size, p.y * size, p.p])
    }
    return this.input
  }
}

function options(style: RenderStyle, size: number, pointerType: PointerKind, last: boolean): StrokeOptions {
  return {
    size: style.width * size,
    thinning: style.thinning,
    smoothing: 0.5,
    streamline: style.streamline,
    // Only pens report meaningful pressure; touch/mouse values are constant or noisy.
    simulatePressure: pointerType !== 'pen',
    start: { cap: true },
    end: { cap: true },
    last,
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: number[][], color: string): void {
  const n = outline.length
  if (n < 2) return
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 0; i < n; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % n]
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  }
  ctx.closePath()
  ctx.fill()
}
