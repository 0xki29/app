import { prefersReducedMotion } from '../workspace/motion'
import {
  buildTimeline,
  frameAt,
  nextStop,
  PACE,
  polylineLength,
  prevStop,
  retime,
  strokeNumber,
  wrapTime,
  type Frame,
  type Pace,
  type Timeline,
} from './timeline'
import type { StrokeData } from './types'

/** What React may read. Replaced only when a field changes — about once per stroke, never per frame. */
export interface AnimatorSnapshot {
  /** Stroke data is loaded and valid. */
  readonly available: boolean
  readonly playing: boolean
  readonly pace: Pace
  /** 1-based stroke shown as "Nét k/N": the one being drawn, else the last completed; 0 = empty box. */
  readonly stroke: number
  readonly total: number
  /** Every stroke is drawn (nothing left for "next"). */
  readonly complete: boolean
}

/** The DOM surface the animator writes to: an SVG path, or a stand-in in tests. */
export interface StrokeElement {
  setAttribute(name: string, value: string): void
}

export interface StrokeTarget {
  /** Receives `data-state` (todo | active | done) and `stroke-dashoffset`. */
  readonly el: StrokeElement
  /** Dash length that reveals the whole stroke (the element's path length). */
  readonly length: number
}

export type StrokeState = 'todo' | 'active' | 'done'

export interface AnimatorOptions {
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (id: number) => void
  now?: () => number
  reducedMotion?: () => boolean
}

/** Longest step per frame: after a hidden tab or a long jank the animation resumes, it does not skip strokes. */
const MAX_FRAME_MS = 100

const EMPTY_TIMELINE: Timeline = { strokes: [], total: 0 }

/**
 * Stroke-order playback: owns the loop time and writes stroke states straight onto SVG paths.
 *
 * Plain TypeScript on purpose, like HandwritingEngine: the rAF loop never touches React. React sends
 * commands (play, pause, step, pace) and reads `getSnapshot()`, which changes about once per stroke.
 * Per frame the only DOM write is the active stroke's dash offset; state attributes change per stroke.
 * The loop runs only while playing and attached to a view.
 */
export class StrokeAnimator {
  private readonly requestFrame: (callback: () => void) => number
  private readonly cancelFrameFn: (id: number) => void
  private readonly now: () => number
  private readonly reducedMotion: () => boolean

  private data: StrokeData | null = null
  private lengths: readonly number[] = []
  private pace: Pace = 'slow'
  private timeline: Timeline = EMPTY_TIMELINE
  private t = 0
  private playing = false

  private targets: readonly StrokeTarget[] | null = null
  private reduced = false
  /** Last values written per target, so unchanged strokes cost nothing per frame. */
  private writtenState: (StrokeState | undefined)[] = []
  private writtenOffset: (number | undefined)[] = []
  private rafId = 0
  private lastFrame = 0

  private snapshot: AnimatorSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(options: AnimatorOptions = {}) {
    this.requestFrame = options.requestFrame ?? ((cb) => window.requestAnimationFrame(cb))
    this.cancelFrameFn = options.cancelFrame ?? ((id) => window.cancelAnimationFrame(id))
    this.now = options.now ?? (() => performance.now())
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion
    this.snapshot = this.makeSnapshot(frameAt(this.timeline, 0))
  }

  // ── React-facing API ────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): AnimatorSnapshot => this.snapshot

  /** Current loop time in ms (debugging and tests). */
  get time(): number {
    return this.t
  }

  /** New character (or none): rebuilds the timeline and plays from the empty box. Same data: no-op. */
  setData(data: StrokeData | null): void {
    if (data === this.data) return
    this.data = data
    this.lengths = data ? data.medians.map(polylineLength) : []
    this.timeline = data ? buildTimeline(this.lengths, PACE[this.pace]) : EMPTY_TIMELINE
    this.t = 0
    this.playing = data !== null
    this.forgetWrites()
    this.update()
  }

  play(): void {
    if (!this.data || this.playing) return
    // From the whole character, "play" means watch it again rather than sit through the hold.
    if (frameAt(this.timeline, this.t).phase === 'hold') this.t = 0
    this.playing = true
    this.update()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.update()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  /** From the empty box, playing. */
  replay(): void {
    if (!this.data) return
    this.t = 0
    this.playing = true
    this.update()
  }

  /** Pauses with the next stroke finished (see nextStop). */
  next(): void {
    this.step(nextStop(this.timeline, this.t))
  }

  /** Pauses with the current or last stroke removed (see prevStop). */
  prev(): void {
    this.step(prevStop(this.timeline, this.t))
  }

  /** Keeps the position: same stroke, same fraction of it. */
  setPace(pace: Pace): void {
    if (pace === this.pace) return
    this.pace = pace
    if (this.data) {
      const next = buildTimeline(this.lengths, PACE[pace])
      this.t = retime(this.timeline, next, this.t)
      this.timeline = next
    }
    this.update()
  }

  // ── DOM lifecycle ───────────────────────────────────────────────────────────

  /**
   * Targets are the strokes of the view, in stroke order. Returns the matching detach. Attaching again
   * replaces the previous targets; a stale detach (StrictMode, remounts) does not undo a newer attach.
   */
  attach(targets: readonly StrokeTarget[]): () => void {
    this.detach()
    this.targets = targets
    this.reduced = this.reducedMotion()
    this.update()
    return () => {
      if (this.targets === targets) this.detach()
    }
  }

  detach(): void {
    if (!this.targets) return
    this.targets = null
    this.forgetWrites()
    this.update()
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  private step(t: number): void {
    if (!this.data) return
    this.t = t
    this.playing = false
    this.update()
  }

  /** Single exit of every command: start/stop the loop, draw, notify. */
  private update(): void {
    const run = this.playing && this.targets !== null && this.timeline.strokes.length > 0
    if (run && this.rafId === 0) {
      this.lastFrame = this.now()
      this.rafId = this.requestFrame(this.frame)
    } else if (!run && this.rafId !== 0) {
      this.cancelFrameFn(this.rafId)
      this.rafId = 0
    }
    const frame = frameAt(this.timeline, this.t)
    this.draw(frame)
    this.publish(frame)
  }

  private frame = (): void => {
    this.rafId = 0
    if (!this.playing || !this.targets) return
    const now = this.now()
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrame))
    this.lastFrame = now
    this.t = wrapTime(this.timeline, this.t + dt)
    const frame = frameAt(this.timeline, this.t)
    this.draw(frame)
    this.publish(frame)
    this.rafId = this.requestFrame(this.frame)
  }

  /**
   * todo strokes are hidden by CSS (a zero-length dash would still paint a round-cap dot); a stroke
   * turns active once it has visible length. Reduced motion: no sweep — the active stroke shows whole.
   */
  private draw(frame: Frame): void {
    const targets = this.targets
    // Until the view and the data describe the same character (they update in the same commit).
    if (!targets || targets.length !== this.lengths.length) return
    for (let i = 0; i < targets.length; i++) {
      const { el, length } = targets[i]
      let state: StrokeState
      let offset: number
      if (i < frame.completed) {
        state = 'done'
        offset = 0
      } else if (i === frame.active && frame.progress > 0) {
        state = 'active'
        offset = this.reduced ? 0 : Math.round(length * (1 - frame.progress) * 10) / 10
      } else {
        state = 'todo'
        offset = length
      }
      if (this.writtenOffset[i] !== offset) {
        el.setAttribute('stroke-dashoffset', String(offset))
        this.writtenOffset[i] = offset
      }
      if (this.writtenState[i] !== state) {
        el.setAttribute('data-state', state)
        this.writtenState[i] = state
      }
    }
  }

  private forgetWrites(): void {
    this.writtenState = []
    this.writtenOffset = []
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  private makeSnapshot(frame: Frame): AnimatorSnapshot {
    const total = this.timeline.strokes.length
    return {
      available: this.data !== null,
      playing: this.playing,
      pace: this.pace,
      stroke: strokeNumber(frame),
      total,
      complete: total > 0 && frame.completed === total,
    }
  }

  /** Called every frame: compares first, allocates only on change. */
  private publish(frame: Frame): void {
    const s = this.snapshot
    const total = this.timeline.strokes.length
    if (
      s.available === (this.data !== null) &&
      s.playing === this.playing &&
      s.pace === this.pace &&
      s.stroke === strokeNumber(frame) &&
      s.total === total &&
      s.complete === (total > 0 && frame.completed === total)
    ) {
      return
    }
    this.snapshot = this.makeSnapshot(frame)
    for (const l of this.listeners) l()
  }
}
