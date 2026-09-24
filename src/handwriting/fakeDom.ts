import type { PointerKind } from './types'

/**
 * Test-only stand-ins for the few DOM pieces InputController and HandwritingEngine touch, so both
 * run under Vitest's node environment. App code never imports this file.
 */

export const BOX_PX = 300

type Listener = (e: never) => void

/** Minimal EventTarget: add/remove listeners, dispatch plain objects. */
class Listeners {
  private readonly map = new Map<string, Set<Listener>>()

  addEventListener = (type: string, fn: Listener): void => {
    let set = this.map.get(type)
    if (!set) this.map.set(type, (set = new Set()))
    set.add(fn)
  }

  removeEventListener = (type: string, fn: Listener): void => {
    this.map.get(type)?.delete(fn)
  }

  fire(type: string, event: unknown): void {
    for (const fn of [...(this.map.get(type) ?? [])]) (fn as (e: unknown) => void)(event)
  }

  listenerCount(): number {
    let n = 0
    for (const set of this.map.values()) n += set.size
    return n
  }
}

/** One pointer sample; x, y in box units (0..1). */
export interface PointerInit {
  t: number
  x?: number
  y?: number
  id?: number
  kind?: PointerKind
  button?: number
  /** Default: 1 (primary pressed) on down/move, 0 on up. */
  buttons?: number
  width?: number
  height?: number
  pressure?: number
}

/** The character box: receives pointer events, tracks pointer capture. */
export class FakeBox extends Listeners {
  readonly captured = new Set<number>()

  get el(): HTMLElement {
    return this as unknown as HTMLElement
  }

  setPointerCapture(id: number): void {
    this.captured.add(id)
  }

  hasPointerCapture(id: number): boolean {
    return this.captured.has(id)
  }

  releasePointerCapture(id: number): void {
    this.captured.delete(id)
  }

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: BOX_PX, height: BOX_PX, right: BOX_PX, bottom: BOX_PX, x: 0, y: 0 } as DOMRect
  }

  down(init: PointerInit): void {
    this.fire('pointerdown', pointerEvent(init, 1))
  }

  move(init: PointerInit): void {
    this.fire('pointermove', pointerEvent(init, 1))
  }

  up(init: PointerInit): void {
    this.fire('pointerup', pointerEvent(init, 0))
  }

  cancel(init: PointerInit): void {
    this.fire('pointercancel', pointerEvent(init, 0))
  }

  lostCapture(init: PointerInit): void {
    this.fire('lostpointercapture', pointerEvent(init, 0))
  }
}

function pointerEvent(init: PointerInit, defaultButtons: number): PointerEvent {
  return {
    pointerId: init.id ?? 1,
    pointerType: init.kind ?? 'touch',
    button: init.button ?? 0,
    buttons: init.buttons ?? defaultButtons,
    clientX: (init.x ?? 0.5) * BOX_PX,
    clientY: (init.y ?? 0.5) * BOX_PX,
    pressure: init.pressure ?? 0.5,
    width: init.width ?? 1,
    height: init.height ?? 1,
    timeStamp: init.t,
    preventDefault() {},
    getCoalescedEvents: () => [],
    getPredictedEvents: () => [],
  } as unknown as PointerEvent
}

/**
 * A canvas whose 2D context accepts every call and draws nothing. `context`: 'null' makes
 * getContext return null, 'throw' makes it throw (both: canvas 2D unavailable).
 */
export function fakeCanvas(context: 'ok' | 'null' | 'throw' = 'ok'): HTMLCanvasElement {
  const canvas = new Listeners() as Listeners & { width: number; height: number; getContext(): unknown }
  canvas.width = BOX_PX
  canvas.height = BOX_PX
  const target: Record<PropertyKey, unknown> = { canvas, getContextAttributes: () => ({ desynchronized: false }) }
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => undefined),
    set: (t, key, value) => {
      t[key] = value
      return true
    },
  })
  canvas.getContext = () => {
    if (context === 'throw') throw new Error('canvas memory exceeded')
    return context === 'null' ? null : ctx
  }
  return canvas as unknown as HTMLCanvasElement
}

/** document: visibility and its listeners. */
export class FakeDocument extends Listeners {
  visibilityState: DocumentVisibilityState = 'visible'

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state
    this.fire('visibilitychange', {})
  }
}

/** Globals the engine reads on attach; stub each with vi.stubGlobal(name, value). */
export function fakeGlobals(doc: FakeDocument): Record<string, unknown> {
  return {
    document: doc,
    window: {
      devicePixelRatio: 1,
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    // Frames never run: live drawing is not what these tests check.
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  }
}
