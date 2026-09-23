import { prefersReducedMotion, watchReducedMotion } from '../workspace/motion'
import {
  buildTimeline,
  frameAt,
  nextStop,
  PACE,
  polylineLength,
  prevStop,
  retime,
  stopAfter,
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
  /** The loop is running (a single "next" step drawing its stroke does not count as playing). */
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
  /** Receives `data-state` (see StrokeState) and `stroke-dashoffset`. */
  readonly el: StrokeElement
  /** Dash length that reveals the whole stroke (the element's path length). */
  readonly length: number
  /**
   * Part of the path before the stroke's median starts (MedianPath.lead). The round cap reaches this
   * far past the dash end, so while a stroke is drawn the dash end runs over [0, length − lead]: the
   * visible front then moves along the median at the speed the timeline was built for, and reaches
   * the stroke's end when its time does. Default 0.
   */
  readonly lead?: number
}

/**
 * todo    — not reached yet (hidden)
 * active  — being drawn; or, while paused between strokes, the stroke named by "Nét k/N"
 * done    — drawn (ink)
 * leaving — fading out at the end of the loop, before the box empties again
 */
export type StrokeState = 'todo' | 'active' | 'done' | 'leaving'

export interface AnimatorOptions {
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (id: number) => void
  now?: () => number
  reducedMotion?: () => boolean
  /** Subscribes to changes of the reduced-motion setting; returns the unsubscribe. */
  watchReducedMotion?: (onChange: () => void) => () => void
}

/** Longest step per frame: after a hidden tab or a long jank the animation resumes, it does not skip strokes. */
const MAX_FRAME_MS = 100

/** The whole character fades out over the end of the hold, so the loop does not cut to an empty box. */
export const LOOP_FADE_MS = 300

const EMPTY_TIMELINE: Timeline = { strokes: [], total: 0 }

/**
 * Stroke-order playback: owns the loop time and writes stroke states straight onto SVG paths.
 *
 * Plain TypeScript on purpose, like HandwritingEngine: the rAF loop never touches React. React sends
 * commands (play, pause, step, pace) and reads `getSnapshot()`, which changes about once per stroke.
 * Per frame the only DOM write is the active stroke's dash offset; state attributes change per stroke.
 * The loop runs only while playing (or drawing one "next" step) and attached to a view.
 */
export class StrokeAnimator {
  private readonly requestFrame: (callback: () => void) => number
  private readonly cancelFrameFn: (id: number) => void
  private readonly now: () => number
  private readonly reducedMotion: () => boolean
  private readonly watchReducedMotion: (onChange: () => void) => () => void

  private data: StrokeData | null = null
  private lengths: readonly number[] = []
  private pace: Pace = 'slow'
  private timeline: Timeline = EMPTY_TIMELINE
  private t = 0
  private playing = false
  /** While a "next" step draws its stroke: the time it stops at. */
  private stepEnd: number | null = null
  /** The last play/pause choice made with the controls, kept across characters; null = none yet. */
  private autoplay: boolean | null = null

  private targets: readonly StrokeTarget[] | null = null
  private reduced = false
  private unwatchReducedMotion: (() => void) | null = null
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
    this.watchReducedMotion = options.watchReducedMotion ?? watchReducedMotion
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

  /** New character (or none): rebuilds the timeline and shows it as `show()` does. Same data: no-op. */
  setData(data: StrokeData | null): void {
    if (data === this.data) return
    this.data = data
    this.lengths = data ? data.medians.map(polylineLength) : []
    this.timeline = data ? buildTimeline(this.lengths, PACE[this.pace]) : EMPTY_TIMELINE
    this.t = 0
    this.playing = false
    this.stepEnd = null
    this.forgetWrites()
    if (data) this.show()
    else this.update()
  }

  /**
   * The character is (re)shown — observe entered, or a new character: it plays from the empty box.
   * If the learner paused last time, or reduced motion is on and they have not pressed play, it rests
   * paused on the whole character instead; play or the step buttons show the order.
   */
  show(): void {
    if (!this.data) return
    const play = this.autoplay ?? !this.reducedMotion()
    this.t = play ? 0 : stopAfter(this.timeline, this.timeline.strokes.length)
    this.playing = play
    this.stepEnd = null
    this.update()
  }

  play(): void {
    if (!this.data || this.playing) return
    // From the whole character, "play" means watch it again rather than sit through the hold.
    if (frameAt(this.timeline, this.t).phase === 'hold') this.t = 0
    this.playing = true
    this.stepEnd = null
    this.update()
  }

  pause(): void {
    if (!this.running) return
    // A step in progress is cut short: its stroke is shown whole.
    if (this.stepEnd !== null) this.t = this.stepEnd
    this.playing = false
    this.stepEnd = null
    this.update()
  }

  /** The play/pause button. The choice carries over to the next characters (see show). */
  toggle(): void {
    if (!this.data) return
    if (this.playing) this.pause()
    else this.play()
    this.autoplay = this.playing
  }

  /** The replay button: from the empty box, playing — and later characters play too. */
  replay(): void {
    if (!this.data) return
    this.t = 0
    this.playing = true
    this.stepEnd = null
    this.autoplay = true
    this.update()
  }

  /**
   * The indicator goes up by one (see nextStop). That stroke is drawn from its start, so its
   * direction shows, and the animation pauses once it is whole. Reduced motion: it appears at once.
   */
  next(): void {
    if (!this.data) return
    const target = nextStop(this.timeline, this.t)
    const span = this.timeline.strokes[frameAt(this.timeline, target).completed - 1]
    if (this.reduced || !this.targets || !span || this.t >= span.end) {
      this.step(target)
      return
    }
    this.t = Math.max(this.t, span.start)
    this.playing = false
    this.stepEnd = span.end
    this.update()
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
      if (this.stepEnd !== null) this.stepEnd = retime(this.timeline, next, this.stepEnd)
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
    this.unwatchReducedMotion = this.watchReducedMotion(this.onReducedMotionChange)
    this.update()
    return () => {
      if (this.targets === targets) this.detach()
    }
  }

  detach(): void {
    if (!this.targets) return
    this.targets = null
    this.unwatchReducedMotion?.()
    this.unwatchReducedMotion = null
    this.forgetWrites()
    this.update()
  }

  /** The setting changed while attached: the sweep follows at once, as the CSS transitions do. */
  private onReducedMotionChange = (): void => {
    this.reduced = this.reducedMotion()
    if (this.reduced && this.stepEnd !== null) {
      this.t = this.stepEnd
      this.stepEnd = null
    }
    this.update()
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  private step(t: number): void {
    if (!this.data) return
    this.t = t
    this.playing = false
    this.stepEnd = null
    this.update()
  }

  private get running(): boolean {
    return this.playing || this.stepEnd !== null
  }

  /** Single exit of every command: start/stop the loop, draw, notify. */
  private update(): void {
    const run = this.running && this.targets !== null && this.timeline.strokes.length > 0
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
    if (!this.running || !this.targets) return
    const now = this.now()
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrame))
    this.lastFrame = now
    if (this.stepEnd !== null) {
      // One step: stop (paused) where its stroke ends; never loop.
      this.t = Math.min(this.stepEnd, this.t + dt)
      if (this.t >= this.stepEnd) this.stepEnd = null
    } else {
      this.t = wrapTime(this.timeline, this.t + dt)
    }
    const frame = frameAt(this.timeline, this.t)
    this.draw(frame)
    this.publish(frame)
    if (this.running) this.rafId = this.requestFrame(this.frame)
  }

  /**
   * todo strokes are hidden by CSS (a zero-length dash would still paint a round-cap dot); a stroke
   * turns active once it has visible length. Reduced motion: no sweep — the active stroke shows whole.
   * Paused between strokes, the last completed stroke stays in the accent color, so the stroke named
   * by "Nét k/N" is the one marked; the whole character rests in ink.
   */
  private draw(frame: Frame): void {
    const targets = this.targets
    // Until the view and the data describe the same character (they update in the same commit).
    if (!targets || targets.length !== this.lengths.length) return
    const n = targets.length
    const marked = !this.running && frame.active < 0 && frame.completed < n ? frame.completed - 1 : -1
    const leaving =
      this.playing && !this.reduced && frame.phase === 'hold' && this.t >= this.timeline.total - LOOP_FADE_MS
    for (let i = 0; i < n; i++) {
      const { el, length, lead = 0 } = targets[i]
      let state: StrokeState
      let offset: number
      if (i === marked) {
        state = 'active'
        offset = 0
      } else if (i < frame.completed) {
        state = leaving ? 'leaving' : 'done'
        offset = 0
      } else if (i === frame.active && frame.progress > 0) {
        state = 'active'
        const sweep = Math.max(0, length - lead)
        offset = this.reduced ? 0 : Math.round((length - sweep * frame.progress) * 10) / 10
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
