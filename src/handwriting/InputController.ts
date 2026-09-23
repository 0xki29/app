import { normalizePoint, type BoxRect } from './coords'
import type { Point, PointerKind } from './types'

/** Why a stroke ended. 'discard' = the stroke must not be committed (e.g. palm replaced by pen). */
export type EndReason = 'up' | 'cancel' | 'discard'

export interface InputHandlers {
  start(point: Point, pointerType: PointerKind, timeStamp: number): void
  /**
   * @param points    new samples (coalesced when supported), duplicates removed
   * @param predicted throwaway predicted samples, empty when disabled/unsupported
   * @param timeStamp event time of the oldest sample in this batch
   * @param samples   raw sample count before de-duplication
   */
  move(points: Point[], predicted: readonly Point[], timeStamp: number, samples: number): void
  end(reason: EndReason): void
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

/**
 * Pointer Events → normalized stroke samples. Tracks exactly one active pointer; no rendering
 * and no React here. Handlers run synchronously inside the DOM event.
 */
export class InputController {
  enabled = true
  predictionEnabled = false
  /** Once a pen is seen, touch input is ignored for the rest of the session (palm rejection). */
  penSeen = false
  readonly support = detectInputSupport()

  private activeId: number | null = null
  private activeKind: PointerKind = 'mouse'
  private rect: BoxRect = { left: 0, top: 0, width: 0, height: 0 }
  private startTs = 0
  private lastX = NaN
  private lastY = NaN
  private readonly el: HTMLElement
  private readonly handlers: InputHandlers

  constructor(el: HTMLElement, handlers: InputHandlers) {
    this.el = el
    this.handlers = handlers
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

  /** End the active stroke normally (it will be committed). */
  finish(): void {
    if (this.activeId === null) return
    this.release()
    this.handlers.end('up')
  }

  /** Drop the active pointer without notifying handlers (caller discards the stroke). */
  cancel(): void {
    this.release()
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return
    const kind = toKind(e.pointerType)
    if (kind === 'pen') this.penSeen = true
    else if (kind === 'touch' && this.penSeen) return

    if (this.activeId !== null) {
      // A pen landing during a touch stroke: that touch was most likely the palm.
      if (kind !== 'pen' || this.activeKind !== 'touch') return
      this.release()
      this.handlers.end('discard')
    }

    e.preventDefault()
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail if the pointer is already gone; the stroke still works inside the box.
    }
    this.refreshRect()
    this.activeId = e.pointerId
    this.activeKind = kind
    this.startTs = e.timeStamp
    const p = normalizePoint(e.clientX, e.clientY, 0, e.pressure, this.rect)
    this.lastX = p.x
    this.lastY = p.y
    this.handlers.start(p, kind, e.timeStamp)
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return
    const coalesced = this.support.coalesced ? e.getCoalescedEvents() : []
    const samples = coalesced.length > 0 ? coalesced : [e]

    const points: Point[] = []
    for (const s of samples) {
      const p = normalizePoint(s.clientX, s.clientY, s.timeStamp - this.startTs, s.pressure, this.rect)
      if (p.x === this.lastX && p.y === this.lastY) continue
      this.lastX = p.x
      this.lastY = p.y
      points.push(p)
    }

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
    if (e.pointerId !== this.activeId) return
    this.release()
    this.handlers.end('up')
  }

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return
    this.release()
    // Keep what was written: losing ink to a browser gesture is worse than a stray stroke.
    this.handlers.end('cancel')
  }

  private onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return
    this.release()
    this.handlers.end('cancel')
  }

  private release(): void {
    const id = this.activeId
    this.activeId = null
    if (id !== null && this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id)
  }
}
