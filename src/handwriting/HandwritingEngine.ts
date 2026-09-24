import { cloneStroke, InkModel } from './InkModel'
import { InputController } from './InputController'
import type { DiscardReason } from './inputPolicy'
import { FreehandRenderer } from './renderers/FreehandRenderer'
import { QuadRenderer } from './renderers/QuadRenderer'
import { clearCanvas, type Renderer, type RendererKind, type RenderStyle } from './renderers/Renderer'
import type { Ink, Point, PointerKind, Stroke, StrokeEnd } from './types'

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
  /**
   * Identifies the current ink: increases on every change to it (a stroke committed, undo, clear,
   * reset of non-empty ink, setInk) and is never reused. getInk() reports the same number.
   */
  readonly inkRevision: number
  readonly inputEnabled: boolean
  readonly settings: EngineSettings
  /**
   * attach() could not get a 2D canvas context (e.g. iOS refuses new canvases when canvas memory
   * runs out): nothing is drawn and no input is taken until an attach succeeds.
   */
  readonly canvasError: boolean
}

/** The committed ink with the revision it was read at (see EngineSnapshot.inkRevision). A deep copy. */
export interface VersionedInk extends Ink {
  readonly revision: number
}

/** A stroke the learner just added to the ink (never one loaded with setInk). */
export interface StrokeCommit {
  /** A copy: listeners may keep it. */
  readonly stroke: Stroke
  /** Its position in the ink, in writing order. */
  readonly index: number
  /** The ink revision that first contains it. */
  readonly revision: number
}

/**
 * start   — a contact began a stroke
 * end     — the stroke was committed to the ink
 * discard — the stroke was dropped; a stroke gets either 'end' or 'discard', never both
 */
export type StrokePhase = 'start' | 'end' | 'discard'

/** Why a stroke in progress was dropped: not writing (inputPolicy), or the box was reset or reloaded. */
export type StrokeDiscard = DiscardReason | 'reset'

/** `detail` is the StrokeEnd for 'end', the StrokeDiscard for 'discard', undefined for 'start'. */
export type StrokePhaseListener = (phase: StrokePhase, detail?: StrokeEnd | StrokeDiscard) => void

/** Mutable instrumentation, read by the debug HUD by polling. Stroke fields cover the current or last stroke. */
export interface EngineStats {
  drawing: boolean
  pointerType: PointerKind | null
  pressure: number
  /** A pen has been used on the box (touch is then blocked only briefly, see inputPolicy). */
  penSeen: boolean
  /** How the last contact ended: kept (StrokeEnd) or dropped (StrokeDiscard). */
  lastEnd: StrokeEnd | StrokeDiscard | null
  /** Contacts dropped this session: taps, palms, strokes cut by a reset. */
  discarded: number
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
  /**
   * Request low-latency `desynchronized` 2D contexts for the live layers. Default false: on GPU
   * compositors (e.g. Chrome on Windows) a desynchronized canvas becomes a hardware overlay without
   * alpha, so its transparent pixels render black over the layers below.
   */
  desynchronized?: boolean
}

const MAX_DPR = 3
const INK_COLOR = '#1c1917'
const NO_POINTS: readonly Point[] = []
/** Event timeStamps above this are already epoch ms (very old engines); others count from timeOrigin. */
const EPOCH_TIMESTAMP_MIN = 1e12

/** Epoch ms of an event timeStamp. performance.timeOrigin is missing before Safari 15. */
function epochMs(timeStamp: number): number {
  if (timeStamp > EPOCH_TIMESTAMP_MIN) return Math.round(timeStamp)
  const origin = Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now() - performance.now()
  return Math.round(origin + timeStamp)
}

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
  /** Per-stroke color overrides for the committed strokes (see setStrokeColors). */
  private strokeColors: readonly (string | null)[] | null = null
  private inputEnabled = true
  private canvasError = false
  private snapshot: EngineSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly strokeListeners = new Set<StrokePhaseListener>()
  private readonly commitListeners = new Set<(commit: StrokeCommit) => void>()
  /** Stroke ids: a random per-engine prefix, so ids in saved ink loaded back do not collide. */
  private readonly idPrefix = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  private strokeSeq = 0

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
    this.desync = options.desynchronized ?? false
    this.snapshot = this.makeSnapshot()
  }

  // ── React-facing API ────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  /**
   * Stroke lifecycle hook for instrumentation. 'end' and 'discard' fire before the snapshot
   * changes; see StrokePhaseListener for the detail.
   */
  onStrokePhase(listener: StrokePhaseListener): () => void {
    this.strokeListeners.add(listener)
    return () => this.strokeListeners.delete(listener)
  }

  /**
   * Called once per stroke the learner commits, after the snapshot has changed (so
   * getSnapshot().inkRevision === commit.revision inside the listener). Not called for ink loaded
   * with setInk, nor for dropped contacts.
   */
  onStrokeCommitted(listener: (commit: StrokeCommit) => void): () => void {
    this.commitListeners.add(listener)
    return () => this.commitListeners.delete(listener)
  }

  /**
   * A deep copy of the committed ink with its revision. A stroke still being written is not in
   * it: call flushInput() first to include it.
   */
  getInk(): VersionedInk {
    return { strokes: this.model.toInk().strokes, revision: this.model.revision }
  }

  /**
   * Replace the ink (restoring saved work, replay): validated, copied, redrawn and published. Drops
   * any stroke in progress, the undo history (loading is not an edit to undo) and stroke colors.
   * Throws a TypeError, changing nothing, if `ink` is invalid (see parseInk).
   */
  setInk(ink: Ink): void {
    this.model.load(ink)
    this.input?.cancel()
    this.dropStroke('reset')
    this.afterModelChange()
  }

  /**
   * End the stroke in progress now, synchronously: it is committed (end 'interrupted') or, if it is
   * only a tap, dropped. Call before reading the ink for scoring, so the ink scored is the ink shown.
   */
  flushInput(): void {
    this.input?.finish()
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
    this.dropStroke('reset')
    this.model.reset()
    this.afterModelChange()
  }

  /**
   * Recolor committed strokes, by index in writing order (null = the normal ink color), e.g. to mark
   * each stroke right or wrong after scoring. The colors describe this particular ink, so any change
   * to it (a new stroke, undo, clear, reset) drops them. `null` restores the ink color.
   *
   * Pass the revision of the ink the colors were computed from (getInk().revision): if the ink has
   * changed since, they are stale and ignored. Returns whether they were applied.
   */
  setStrokeColors(colors: readonly (string | null)[] | null, revision?: number): boolean {
    if (revision !== undefined && revision !== this.model.revision) return false
    this.strokeColors = colors ? colors.slice() : null
    this.redrawStatic()
    return true
  }

  /** Disabling ends a stroke in progress like flushInput() (end 'interrupted'). */
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

  /**
   * Take over the box and its canvases. Never throws for a missing 2D context: the engine then
   * stays inert (no drawing, no input) and reports snapshot.canvasError until an attach succeeds.
   */
  attach(layers: EngineLayers): () => void {
    this.detach()
    const ctx = getContexts(layers, this.desync)
    this.setCanvasError(ctx === null)
    if (!ctx) return noop
    this.layers = layers
    this.ctx = ctx

    const input = new InputController(layers.box, {
      start: this.startStroke,
      move: this.extendStroke,
      end: this.endStroke,
      discard: this.dropStroke,
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
    const id = `${this.idPrefix}-${++this.strokeSeq}`
    this.current = { points: [point], pointerType, id, startedAt: epochMs(timeStamp) }
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

  private endStroke = (reason: StrokeEnd): void => {
    const stroke = this.takeStroke()
    if (!stroke) return
    stroke.end = reason
    // Commit: one full-quality draw onto the static layer, in the same task as clearing live,
    // so the swap is invisible.
    const added = this.model.add(stroke)
    if (added) {
      const ctx = this.ctx
      if (this.strokeColors) {
        // The ink changed: marks for the previous ink no longer apply.
        this.strokeColors = null
        this.redrawStatic()
      } else if (ctx && this.cssSize > 0) {
        this.renderer().drawStroke(ctx.stat, stroke, this.cssSize, this.style)
      }
    }
    const s = this.stats
    s.lastEnd = reason
    s.strokeCount = this.model.strokeCount
    this.emitStroke('end', reason)
    this.publish()
    if (added && this.commitListeners.size > 0) {
      const commit: StrokeCommit = {
        stroke: cloneStroke(stroke),
        index: this.model.strokeCount - 1,
        revision: this.model.revision,
      }
      for (const l of this.commitListeners) l(commit)
    }
  }

  /** Drop the stroke in progress, if any: nothing reaches the ink. */
  private dropStroke = (reason: StrokeDiscard): void => {
    if (!this.takeStroke()) return
    const s = this.stats
    s.lastEnd = reason
    s.discarded++
    this.emitStroke('discard', reason)
  }

  /** Take the stroke in progress off the live layers and return it. */
  private takeStroke(): Stroke | null {
    const stroke = this.current
    if (!stroke) return null
    this.current = null
    this.predicted = NO_POINTS
    this.cancelFrame()
    const ctx = this.ctx
    if (ctx) {
      clearCanvas(ctx.live)
      clearCanvas(ctx.tail)
    }
    const s = this.stats
    s.drawing = false
    s.strokeEndMs = performance.now()
    return stroke
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
    this.strokeColors = null
    this.redrawStatic()
    this.stats.strokeCount = this.model.strokeCount
    this.publish()
  }

  private redrawStatic(): void {
    const ctx = this.ctx
    if (!ctx || this.cssSize === 0) return
    clearCanvas(ctx.stat)
    const r = this.renderer()
    this.model.strokes.forEach((stroke, i) => {
      const color = this.strokeColors?.[i]
      r.drawStroke(ctx.stat, stroke, this.cssSize, color ? { ...this.style, color } : this.style)
    })
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
      inkRevision: this.model.revision,
      inputEnabled: this.inputEnabled,
      settings: this.settings,
      canvasError: this.canvasError,
    }
  }

  private publish(): void {
    const prev = this.snapshot
    const next = this.makeSnapshot()
    if (
      prev.canUndo === next.canUndo &&
      prev.strokeCount === next.strokeCount &&
      prev.inkRevision === next.inkRevision &&
      prev.inputEnabled === next.inputEnabled &&
      prev.settings === next.settings &&
      prev.canvasError === next.canvasError
    ) {
      return
    }
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  private setCanvasError(failed: boolean): void {
    if (this.canvasError === failed) return
    this.canvasError = failed
    if (failed) console.error('[engine] Canvas 2D is not available')
    this.publish()
  }

  private emitStroke(phase: StrokePhase, detail?: StrokeEnd | StrokeDiscard): void {
    for (const l of this.strokeListeners) l(phase, detail)
  }
}

function noop(): void {}

/** All three contexts, or null if any is unavailable (getContext returns null or throws). */
function getContexts(layers: EngineLayers, desynchronized: boolean): Contexts | null {
  const stat = get2d(layers.staticCanvas, false)
  const live = get2d(layers.liveCanvas, desynchronized)
  const tail = get2d(layers.tailCanvas, desynchronized)
  return stat && live && tail ? { stat, live, tail } : null
}

function get2d(canvas: HTMLCanvasElement, desynchronized: boolean): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', desynchronized ? { desynchronized: true } : undefined)
  } catch {
    return null
  }
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
    lastEnd: null,
    discarded: 0,
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
