import type { Point, Stroke } from '../types'

export type RendererKind = 'quad' | 'freehand'

export interface RenderStyle {
  /** Stroke diameter as a fraction of the box size. */
  width: number
  color: string
  /** Renderer B only: how much speed/pressure narrows the stroke. */
  thinning: number
  /** Renderer B only: input smoothing (higher = smoother, but trails the finger). */
  streamline: number
}

/**
 * A drawing strategy. Points are normalized; `size` is the box size in CSS px, and every
 * context is pre-scaled so that 1 unit = 1 CSS px.
 */
export interface Renderer {
  readonly kind: RendererKind
  /** Draw one complete stroke (committed layer, full redraws). */
  drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, size: number, style: RenderStyle): void
  /** Forget per-stroke live state. Called at stroke start and before any full live redraw. */
  beginLive(): void
  /**
   * Draw the stroke in progress. `live` keeps its pixels between frames (the engine clears it on
   * stroke start/end); `tail` is scratch space the renderer may clear and redraw every frame.
   */
  drawLive(
    live: CanvasRenderingContext2D,
    tail: CanvasRenderingContext2D,
    stroke: Stroke,
    predicted: readonly Point[],
    size: number,
    style: RenderStyle,
  ): void
}

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}
