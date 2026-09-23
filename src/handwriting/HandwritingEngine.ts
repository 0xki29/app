import { InkModel } from './InkModel'
import { InputController, type EndReason } from './InputController'
import { FreehandRenderer } from './renderers/FreehandRenderer'
import { QuadRenderer } from './renderers/QuadRenderer'
import { clearCanvas, type Renderer, type RendererKind, type RenderStyle } from './renderers/Renderer'
import type { Ink, Point, PointerKind, Stroke } from './types'

export interface EngineSettings {
  renderer: RendererKind
  /** Stroke diameter as a fraction of the box size. */
  strokeWidth: number
  /** Draw PointerEvent.getPredictedEvents() as a throwaway tail, where supported. */
  predicted: boolean
  /** Renderer B only. */
  thinning: number
  /** Renderer B only. */
  streamline: number
}

export const DEFAULT_SETTINGS: EngineSettings = {
  renderer: 'quad',
  strokeWidth: 0.035,
  predicted: false,
  thinning: 0.5,
  streamline: 0.3,
}

/** What React may read. Replaced only on commit-level changes — never per pointer sample. */
export interface EngineSnapshot {
  readonly canUndo: boolean
  readonly strokeCount: number
  readonly inputEnabled: boolean
  readonly settings: EngineSettings
}

/** Mutable instrumentation, read by the debug HUD by polling. Stroke fields cover the current or last stroke. */
export interface EngineStats {
  drawing: boolean
  pointerType: PointerKind | null
  pressure: number
  penSeen: boolean
  strokePoints: number
  strokeMoveEvents: number
  /** Raw samples incl. coalesced ones, before de-duplication. */
  strokeSamples: number
  strokeStartMs: number
  strokeEndMs: number
  frames: number
  frameMsSum: number
  frameMsMax: number
  lastFrameMs: number
  /** performance.now() at draw minus the oldest undrawn sample's event time. JS-side only. */
  inputToDrawMs: number
  inputToDrawMaxMs: number
  strokeCount: number
  cssSize: number
  backingSize: number
  dpr: number
  deviceDpr: number
  supportsCoalesced: boolean
  supportsPredicted: boolean
  desynchronized: boolean
}

export interface EngineLayers {
  /** Square box that receives pointer input; every canvas covers it exactly. */
  box: HTMLElement
  staticCanvas: HTMLCanvasElement
  liveCanvas: HTMLCanvasElement
  tailCanvas: HTMLCanvasElement
}

export interface EngineOptions {
  /** Request low-latency `desynchronized` 2D contexts for the live layers. Default true. */
  desynchronized?: boolean
}

export type StrokePhase = 'start' | 'end'

const MAX_DPR = 3
const INK_COLOR = '#1c1917'
const NO_POINTS: readonly Point[] = []

interface Contexts {
  stat: CanvasRenderingContext2D
  live: CanvasRenderingContext2D
  tail: CanvasRenderingContext2D
}

/**
 * Real-time handwriting: ink model, pointer input, canvases and the rAF loop.
 *
 * Plain TypeScript on purpose. Pointer samples go InputController → current stroke → rAF draw,
 * and never touch React. React drives it through commands (undo/clear/reset/settings) and reads
 * `getSnapshot()`, which only changes when a stroke is committed or a command runs.
 *
 * Layers (bottom → top): static canvas (committed strokes), live canvas (stroke in progress),
 * tail canvas (per-frame scratch: unsettled tail + predicted points).
 */
export class HandwritingEngine {
  readonly stats: EngineStats = createStats()

  private readonly model = new InkModel()
  private readonly renderers: Record<RendererKind, Renderer> = {
    quad: new QuadRenderer(),
    freehand: new FreehandRenderer(),
  }
  private readonly desync: boolean
  private settings: EngineSettings = DEFAULT_SETTINGS
  private style: RenderStyle = toStyle(DEFAULT_SETTINGS)
  private inputEnabled = true
  private snapshot: EngineSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly strokeListeners = new Set<(phase: StrokePhase) => void>()

  private layers: EngineLayers | null = null
  private ctx: Contexts | null = null
  private input: InputController | null = null
  private resizeObserver: ResizeObserver | null = null
  private dprQuery: MediaQueryList | null = null
  private cssSize = 0

  private current: Stroke | null = null
  private predicted: readonly Point[] = NO_POINTS
  private rafId = 0
  private oldestPendingTs = 0

  constructor(options: EngineOptions = {}) {
    this.desync = options.desynchronized ?? true
    this.snapshot = this.makeSnapshot()
  }

  // ── React-facing API ────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  /** Stroke lifecycle hook for instrumentation. 'end' fires before the snapshot changes. */
  onStrokePhase(listener: (phase: StrokePhase) => void): () => void {
    this.strokeListeners.add(listener)
    return () => this.strokeListeners.delete(listener)
  }

  getInk(): Ink {
    return this.model.toInk()
  }

  undo(): void {
    if (this.model.undo()) this.afterModelChange()
  }

  clear(): void {
    if (this.model.clear()) this.afterModelChange()
  }

  /** Fresh box for a new character or mode: drops ink, history and any stroke in progress. */
  reset(): void {
    this.input?.cancel()
    this.endStroke('discard')
    this.model.reset()
    this.afterModelChange()
  }

  setInputEnabled(enabled: boolean): void {
    if (this.inputEnabled === enabled) return
    this.inputEnabled = enabled
    if (this.input) {
      this.input.enabled = enabled
      if (!enabled) this.input.finish()
    }
    this.publish()
  }

  setSettings(patch: Partial<EngineSettings>): void {
    const prev = this.settings
    const next = { ...prev, ...patch }
    this.settings = next
    this.style = toStyle(next)
    if (this.input) this.input.predictionEnabled = next.predicted
    const looksDifferent =
      next.renderer !== prev.renderer ||
      next.strokeWidth !== prev.strokeWidth ||
      next.thinning !== prev.thinning ||
      next.streamline !== prev.streamline
    if (looksDifferent) {
      this.redrawStatic()
      this.restartLive()
    }
    this.publish()
  }

  // ── DOM lifecycle ───────────────────────────────────────────────────────────

  attach(layers: EngineLayers): () => void {
    this.detach()
    const ctx: Contexts = {
      stat: get2d(layers.staticCanvas, false),
      live: get2d(layers.liveCanvas, this.desync),
      tail: get2d(layers.tailCanvas, this.desync),
    }
    this.layers = layers
    this.ctx = ctx

    const input = new InputController(layers.box, {
      start: this.startStroke,
      move: this.extendStroke,
      end: this.endStroke,
    })
    input.enabled = this.inputEnabled
    input.predictionEnabled = this.settings.predicted
    this.input = input

    const s = this.stats
    s.supportsCoalesced = input.support.coalesced
    s.supportsPredicted = input.support.predicted
    s.desynchronized = ctx.live.getContextAttributes?.().desynchronized ?? false

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(layers.box)
    this.watchDpr()
    document.addEventListener('visibilitychange', this.onVisibility)
    for (const c of [layers.staticCanvas, layers.liveCanvas, layers.tailCanvas]) {
      c.addEventListener('contextrestored', this.onContextRestored)
    }
    this.resize()
    return () => this.detach()
  }

  detach(): void {
    const layers = this.layers
    if (!layers) return
    this.input?.finish()
    this.input?.destroy()
    this.input = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.dprQuery?.removeEventListener('change', this.onDprChange)
    this.dprQuery = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const c of [layers.staticCanvas, layers.liveCanvas, layers.tailCanvas]) {
      c.removeEventListener('contextrestored', this.onContextRestored)
    }
    this.cancelFrame()
    this.layers = null
    this.ctx = null
    this.cssSize = 0
    this.stats.backingSize = 0
  }

  // ── Stroke pipeline (called synchronously from pointer events) ─────────────

  private startStroke = (point: Point, pointerType: PointerKind, timeStamp: number): void => {
    this.current = { points: [point], pointerType }
    this.predicted = NO_POINTS
    const s = this.stats
    s.drawing = true
    s.pointerType = pointerType
    s.pressure = point.p
    s.penSeen = this.input?.penSeen ?? false
    s.strokePoints = 1
    s.strokeMoveEvents = 0
    s.strokeSamples = 1
    s.strokeStartMs = performance.now()
    s.strokeEndMs = 0
    s.frames = 0
    s.frameMsSum = 0
    s.frameMsMax = 0
    s.inputToDrawMaxMs = 0
    this.emitStroke('start')
    this.restartLive()
    this.oldestPendingTs = timeStamp
  }

  private extendStroke = (points: Point[], predicted: readonly Point[], timeStamp: number, samples: number): void => {
    const stroke = this.current
    if (!stroke) return
    for (const p of points) stroke.points.push(p)
    this.predicted = predicted
    const s = this.stats
    s.strokeMoveEvents++
    s.strokeSamples += samples
    s.strokePoints = stroke.points.length
    if (points.length > 0) s.pressure = points[points.length - 1].p
    if (this.rafId === 0) this.oldestPendingTs = timeStamp
    this.scheduleFrame()
  }

  private endStroke = (reason: EndReason): void => {
    const stroke = this.current
    if (!stroke) return
    this.current = null
    this.predicted = NO_POINTS
    this.cancelFrame()
    const ctx = this.ctx
    if (ctx) {
      clearCanvas(ctx.live)
      clearCanvas(ctx.tail)
    }
    // Commit: one full-quality draw onto the static layer, in the same task as clearing live,
    // so the swap is invisible.
    if (reason !== 'discard' && this.model.add(stroke) && ctx && this.cssSize > 0) {
      this.renderer().drawStroke(ctx.stat, stroke, this.cssSize, this.style)
    }
    const s = this.stats
    s.drawing = false
    s.strokeEndMs = performance.now()
    s.strokeCount = this.model.strokeCount
    this.emitStroke('end')
    this.publish()
  }

  private scheduleFrame(): void {
    if (this.rafId === 0) this.rafId = requestAnimationFrame(this.frame)
  }

  private cancelFrame(): void {
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  private frame = (): void => {
    this.rafId = 0
    const stroke = this.current
    const ctx = this.ctx
    if (!stroke || !ctx || this.cssSize === 0) return
    const t0 = performance.now()
    this.renderer().drawLive(ctx.live, ctx.tail, stroke, this.predicted, this.cssSize, this.style)
    const dt = performance.now() - t0
    const s = this.stats
    s.lastFrameMs = dt
    s.frames++
    s.frameMsSum += dt
    if (dt > s.frameMsMax) s.frameMsMax = dt
    s.inputToDrawMs = t0 - this.oldestPendingTs
    if (s.inputToDrawMs > s.inputToDrawMaxMs) s.inputToDrawMaxMs = s.inputToDrawMs
  }

  // ── Redraw from the model ──────────────────────────────────────────────────

  private renderer(): Renderer {
    return this.renderers[this.settings.renderer]
  }

  private afterModelChange(): void {
    this.redrawStatic()
    this.stats.strokeCount = this.model.strokeCount
    this.publish()
  }

  private redrawStatic(): void {
    const ctx = this.ctx
    if (!ctx || this.cssSize === 0) return
    clearCanvas(ctx.stat)
    const r = this.renderer()
    for (const stroke of this.model.strokes) r.drawStroke(ctx.stat, stroke, this.cssSize, this.style)
  }

  /** Wipe the live layers and redraw the stroke in progress (if any) from scratch next frame. */
  private restartLive(): void {
    const ctx = this.ctx
    if (ctx) {
      clearCanvas(ctx.live)
      clearCanvas(ctx.tail)
    }
    this.renderer().beginLive()
    if (this.current) this.scheduleFrame()
  }

  private resize = (): void => {
    const layers = this.layers
    const ctx = this.ctx
    if (!layers || !ctx) return
    const size = layers.box.getBoundingClientRect().width
    if (size <= 0) return
    const deviceDpr = window.devicePixelRatio || 1
    const dpr = Math.min(deviceDpr, MAX_DPR)
    const backing = Math.max(1, Math.round(size * dpr))
    const s = this.stats
    s.dpr = dpr
    s.deviceDpr = deviceDpr
    if (size === this.cssSize && backing === s.backingSize) return

    this.cssSize = size
    s.cssSize = size
    s.backingSize = backing
    for (const c of [ctx.stat, ctx.live, ctx.tail]) {
      c.canvas.width = backing // also resets context state
      c.canvas.height = backing
    }
    this.applyTransforms()
    this.input?.refreshRect()
    this.redrawStatic()
    this.restartLive()
  }

  private applyTransforms(): void {
    const ctx = this.ctx
    if (!ctx || this.cssSize === 0) return
    const k = this.stats.backingSize / this.cssSize
    for (const c of [ctx.stat, ctx.live, ctx.tail]) c.setTransform(k, 0, 0, k, 0, 0)
  }

  /** ResizeObserver does not fire when only the DPR changes (e.g. window moved to another monitor). */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange)
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    this.dprQuery.addEventListener('change', this.onDprChange)
  }

  private onDprChange = (): void => {
    this.watchDpr()
    this.resize()
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.input?.finish()
    } else {
      // Browsers may drop canvas backing stores in the background; the model is the truth.
      this.redrawStatic()
      this.restartLive()
    }
  }

  private onContextRestored = (): void => {
    this.applyTransforms()
    this.redrawStatic()
    this.restartLive()
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  private makeSnapshot(): EngineSnapshot {
    return {
      canUndo: this.model.canUndo,
      strokeCount: this.model.strokeCount,
      inputEnabled: this.inputEnabled,
      settings: this.settings,
    }
  }

  private publish(): void {
    const prev = this.snapshot
    const next = this.makeSnapshot()
    if (
      prev.canUndo === next.canUndo &&
      prev.strokeCount === next.strokeCount &&
      prev.inputEnabled === next.inputEnabled &&
      prev.settings === next.settings
    ) {
      return
    }
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  private emitStroke(phase: StrokePhase): void {
    for (const l of this.strokeListeners) l(phase)
  }
}

function get2d(canvas: HTMLCanvasElement, desynchronized: boolean): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', desynchronized ? { desynchronized: true } : undefined)
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

function toStyle(s: EngineSettings): RenderStyle {
  return { width: s.strokeWidth, color: INK_COLOR, thinning: s.thinning, streamline: s.streamline }
}

function createStats(): EngineStats {
  return {
    drawing: false,
    pointerType: null,
    pressure: 0,
    penSeen: false,
    strokePoints: 0,
    strokeMoveEvents: 0,
    strokeSamples: 0,
    strokeStartMs: 0,
    strokeEndMs: 0,
    frames: 0,
    frameMsSum: 0,
    frameMsMax: 0,
    lastFrameMs: 0,
    inputToDrawMs: 0,
    inputToDrawMaxMs: 0,
    strokeCount: 0,
    cssSize: 0,
    backingSize: 0,
    dpr: 1,
    deviceDpr: 1,
    supportsCoalesced: false,
    supportsPredicted: false,
    desynchronized: false,
  }
}
