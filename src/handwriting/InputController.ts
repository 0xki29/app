import { normalizePoint, type BoxRect } from './coords'
import {
  decideDown,
  dropsAtEnd,
  isPalmContact,
  isStill,
  isUnsettled,
  releasedWithoutUp,
  stillPressEnd,
  type DiscardReason,
  type StrokeProgress,
} from './inputPolicy'
import type { Point, PointerKind, StrokeEnd } from './types'

export interface InputHandlers {
  start(point: Point, pointerType: PointerKind, timeStamp: number): void
  /**
   * @param points    new samples (coalesced when supported), duplicates removed
   * @param predicted throwaway predicted samples, empty when disabled/unsupported
   * @param timeStamp event time of the oldest sample in this batch
   * @param samples   raw sample count before de-duplication
   */
  move(points: Point[], predicted: readonly Point[], timeStamp: number, samples: number): void
  /** The stroke is over and is writing: keep it. */
  end(reason: StrokeEnd): void
  /** The contact was not writing (see inputPolicy): drop the stroke. */
  discard(reason: DiscardReason): void
}

export interface InputOptions {
  /** Clock for strokes the app ends itself (finish); same timeline as PointerEvent.timeStamp. */
  now?: () => number
}

export interface InputSupport {
  coalesced: boolean
  predicted: boolean
}

/** Both APIs are secure-context only: plain-http LAN URLs report false. */
export function detectInputSupport(): InputSupport {
  const proto = typeof PointerEvent === 'undefined' ? null : PointerEvent.prototype
  return {
    coalesced: proto !== null && 'getCoalescedEvents' in proto,
    predicted: proto !== null && 'getPredictedEvents' in proto,
  }
}

const NONE: readonly Point[] = []

function toKind(pointerType: string): PointerKind {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse'
}

function preventDefault(e: Event): void {
  e.preventDefault()
}

const defaultNow = (): number => performance.now()

/** A touch watched next to the still one in progress (see inputPolicy: standby). */
interface Standby {
  id: number
  startTs: number
  startX: number
  startY: number
  reach: number
  /** Its samples so far, normalized, the first at t = 0: the stroke it starts if it takes over. */
  points: Point[]
}

/**
 * Pointer Events → normalized stroke samples. Tracks one active pointer (plus, for touch, one
 * standby touch that may take over); no rendering and no React here. Handlers run synchronously
 * inside the DOM event. Which contacts become strokes (taps, palms, pen priority, lost pointerups)
 * is decided by inputPolicy.
 */
export class InputController {
  enabled = true
  predictionEnabled = false
  /** A pen has been used on this box (instrumentation; touch is blocked only briefly, see inputPolicy). */
  penSeen = false
  readonly support = detectInputSupport()

  private activeId: number | null = null
  private activeKind: PointerKind = 'mouse'
  private rect: BoxRect = { left: 0, top: 0, width: 0, height: 0 }
  private startTs = 0
  /** PointerEvent.buttons at pointerdown (see releasedWithoutUp). */
  private downButtons = 0
  private startX = 0
  private startY = 0
  /** Farthest distance from the first sample, in box units (see inputPolicy). */
  private reach = 0
  private lastX = NaN
  private lastY = NaN
  /** Time (Point.t) and pressure of the last sample passed on. */
  private lastT = 0
  private lastP = 0
  /** Another touch was down during the active one (see dropsAtEnd). */
  private crowded = false
  private standby: Standby | null = null
  private lastPenTs = -Infinity
  private readonly el: HTMLElement
  private readonly handlers: InputHandlers
  private readonly now: () => number

  constructor(el: HTMLElement, handlers: InputHandlers, options: InputOptions = {}) {
    this.el = el
    this.handlers = handlers
    this.now = options.now ?? defaultNow
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onCancel)
    el.addEventListener('lostpointercapture', this.onLostCapture)
    el.addEventListener('contextmenu', preventDefault)
    el.addEventListener('dragstart', preventDefault)
    // Fallback for browsers that still scroll/zoom despite `touch-action: none` (older iOS).
    el.addEventListener('touchstart', preventDefault, { passive: false })
    el.addEventListener('touchmove', preventDefault, { passive: false })
  }

  destroy(): void {
    const el = this.el
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('lostpointercapture', this.onLostCapture)
    el.removeEventListener('contextmenu', preventDefault)
    el.removeEventListener('dragstart', preventDefault)
    el.removeEventListener('touchstart', preventDefault)
    el.removeEventListener('touchmove', preventDefault)
    this.release()
  }

  get active(): boolean {
    return this.activeId !== null
  }

  /** Re-read the box position, e.g. after a resize during a stroke. */
  refreshRect(): void {
    const r = this.el.getBoundingClientRect()
    this.rect = { left: r.left, top: r.top, width: r.width, height: r.height }
  }

  /**
   * End the active stroke now, from the app's side (input disabled, tab hidden, flush before
   * scoring). It is kept with end 'interrupted' — or dropped if it never moved (see dropsAtEnd).
   * A standby touch is forgotten.
   */
  finish(): void {
    this.forgetStandby()
    if (this.activeId === null) return
    this.endActive('interrupted', this.now())
  }

  /** Drop the active pointer without notifying handlers (caller discards the stroke). */
  cancel(): void {
    this.release()
  }

  private onDown = (e: PointerEvent): void => {
    const kind = toKind(e.pointerType)
    this.notePen(kind, e.timeStamp)
    if (!this.enabled) return
    const decision = decideDown(
      { kind, button: e.button, width: e.width, height: e.height, timeStamp: e.timeStamp },
      this.progress(),
      this.lastPenTs,
    )
    if (decision.action === 'ignore') return
    if (decision.action === 'standby') {
      if (this.standby === null) this.watch(e)
      return
    }
    if (decision.action === 'replace') this.dropActive('palm')
    if (decision.action === 'restart') this.endActive('lost', e.timeStamp)

    e.preventDefault()
    this.capture(e.pointerId)
    this.refreshRect()
    this.activeId = e.pointerId
    this.activeKind = kind
    this.startTs = e.timeStamp
    this.downButtons = e.buttons
    this.crowded = false
    const p = normalizePoint(e.clientX, e.clientY, 0, e.pressure, this.rect)
    this.begin(p)
    this.handlers.start(p, kind, e.timeStamp)
  }

  private onMove = (e: PointerEvent): void => {
    const kind = toKind(e.pointerType)
    // Hover counts too: a pen held just above the screen means the hand is resting on it.
    this.notePen(kind, e.timeStamp)
    if (this.standby !== null && e.pointerId === this.standby.id) {
      this.moveStandby(e)
      return
    }
    if (e.pointerId !== this.activeId) return
    if (releasedWithoutUp(kind, e.buttons, this.downButtons)) {
      // The samples of this event are hover positions, not ink.
      this.endActive('lost', e.timeStamp)
      return
    }
    // A palm's contact often grows after it lands; drop it while it could still be one.
    const grown = kind === 'touch' && isPalmContact(e.width, e.height) ? this.progress() : null
    if (grown && isUnsettled(grown, e.timeStamp)) {
      this.dropActive('palm', true)
      this.promoteStandby()
      return
    }

    const samples = this.samplesOf(e)
    const points: Point[] = []
    for (const s of samples) {
      const p = normalizePoint(s.clientX, s.clientY, s.timeStamp - this.startTs, s.pressure, this.rect)
      if (p.x === this.lastX && p.y === this.lastY) continue
      this.lastX = p.x
      this.lastY = p.y
      this.lastT = p.t
      this.lastP = p.p
      const d = Math.hypot(p.x - this.startX, p.y - this.startY)
      if (d > this.reach) this.reach = d
      points.push(p)
    }
    // Writing: a touch watched next to it was the palm.
    if (!isStill(this.reach)) this.forgetStandby()

    let predicted = NONE
    if (this.predictionEnabled && this.support.predicted) {
      const pe = e.getPredictedEvents()
      if (pe.length > 0) {
        predicted = pe.map((s) => normalizePoint(s.clientX, s.clientY, s.timeStamp - this.startTs, s.pressure, this.rect))
      }
    }

    this.handlers.move(points, predicted, samples[0].timeStamp, samples.length)
  }

  private onUp = (e: PointerEvent): void => {
    this.notePen(toKind(e.pointerType), e.timeStamp)
    this.endContact(e, 'up')
  }

  private onCancel = (e: PointerEvent): void => {
    // Keep what was written: losing ink to a browser gesture is worse than a stray stroke.
    this.endContact(e, 'cancel')
  }

  private onLostCapture = (e: PointerEvent): void => {
    this.endContact(e, 'lost')
  }

  /** A contact is over: the standby touch is forgotten; the active stroke ends, and a standby touch still down may write. */
  private endContact(e: PointerEvent, reason: StrokeEnd): void {
    if (this.standby !== null && e.pointerId === this.standby.id) {
      this.forgetStandby()
      return
    }
    if (e.pointerId !== this.activeId) return
    this.endActive(reason, e.timeStamp, true)
    this.promoteStandby()
  }

  private notePen(kind: PointerKind, timeStamp: number): void {
    if (kind !== 'pen') return
    this.penSeen = true
    if (timeStamp > this.lastPenTs) this.lastPenTs = timeStamp
  }

  private progress(): StrokeProgress | null {
    return this.activeId === null ? null : { kind: this.activeKind, startTs: this.startTs, reach: this.reach }
  }

  /** The event's samples: coalesced ones where supported. */
  private samplesOf(e: PointerEvent): readonly PointerEvent[] {
    const coalesced = this.support.coalesced ? e.getCoalescedEvents() : []
    return coalesced.length > 0 ? coalesced : [e]
  }

  /** The active stroke's first sample. */
  private begin(p: Point): void {
    this.startX = this.lastX = p.x
    this.startY = this.lastY = p.y
    this.lastT = 0
    this.lastP = p.p
    this.reach = 0
  }

  /**
   * Every way a stroke ends goes through here, so a tap is never kept, however it ended. A kept
   * press that never moved gets a last sample at the lift (see stillPressEnd). `keepStandby`: a
   * standby touch stays (to be promoted by the caller); otherwise it is forgotten too.
   */
  private endActive(reason: StrokeEnd, timeStamp: number, keepStandby = false): void {
    const duration = timeStamp - this.startTs
    const dropped = dropsAtEnd(this.reach, duration, reason, this.crowded)
    const holdUntil = dropped ? null : stillPressEnd(this.reach, this.lastT, duration)
    this.release(keepStandby)
    if (dropped) {
      this.handlers.discard(dropped)
      return
    }
    if (holdUntil !== null) this.handlers.move([{ x: this.lastX, y: this.lastY, t: holdUntil, p: this.lastP }], NONE, timeStamp, 0)
    this.handlers.end(reason)
  }

  private dropActive(reason: DiscardReason, keepStandby = false): void {
    this.release(keepStandby)
    this.handlers.discard(reason)
  }

  private release(keepStandby = false): void {
    const id = this.activeId
    this.activeId = null
    if (id !== null) this.uncapture(id)
    if (!keepStandby) this.forgetStandby()
  }

  // ── Standby touch (see inputPolicy: TAKEOVER_MAX_REACH) ────────────────────

  private watch(e: PointerEvent): void {
    e.preventDefault()
    this.capture(e.pointerId)
    const p = normalizePoint(e.clientX, e.clientY, 0, e.pressure, this.rect)
    this.standby = { id: e.pointerId, startTs: e.timeStamp, startX: p.x, startY: p.y, reach: 0, points: [p] }
    this.crowded = true
  }

  private moveStandby(e: PointerEvent): void {
    const sb = this.standby!
    if (isPalmContact(e.width, e.height)) {
      this.forgetStandby()
      return
    }
    for (const s of this.samplesOf(e)) {
      const p = normalizePoint(s.clientX, s.clientY, s.timeStamp - sb.startTs, s.pressure, this.rect)
      const last = sb.points[sb.points.length - 1]
      if (p.x === last.x && p.y === last.y) continue
      sb.reach = Math.max(sb.reach, Math.hypot(p.x - sb.startX, p.y - sb.startY))
      sb.points.push(p)
    }
    // It writes, and the stroke in progress has not moved: that one was the palm.
    if (!isStill(sb.reach) && isStill(this.reach)) {
      this.dropActive('palm', true)
      this.takeOver(e.timeStamp)
    }
  }

  /** The active stroke is over: a standby touch still down is now the only contact, and may write. */
  private promoteStandby(): void {
    if (this.standby !== null && this.activeId === null) this.takeOver(this.standby.startTs)
  }

  /** The standby touch becomes the active stroke, with the samples it has so far. It had company. */
  private takeOver(timeStamp: number): void {
    const sb = this.standby!
    this.standby = null
    this.activeId = sb.id
    this.activeKind = 'touch'
    this.startTs = sb.startTs
    this.downButtons = 1
    this.crowded = true
    const [first, ...rest] = sb.points
    this.begin(first)
    this.handlers.start(first, 'touch', sb.startTs)
    const last = sb.points[sb.points.length - 1]
    this.lastX = last.x
    this.lastY = last.y
    this.lastT = last.t
    this.lastP = last.p
    this.reach = sb.reach
    if (rest.length > 0) this.handlers.move(rest, NONE, timeStamp, rest.length)
  }

  private forgetStandby(): void {
    const sb = this.standby
    if (sb === null) return
    this.standby = null
    this.uncapture(sb.id)
  }

  private capture(id: number): void {
    try {
      this.el.setPointerCapture(id)
    } catch {
      // Capture can fail if the pointer is already gone; the stroke still works inside the box.
    }
  }

  private uncapture(id: number): void {
    if (this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id)
  }
}
