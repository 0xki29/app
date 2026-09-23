import type { Point } from './types'

/** Viewport-space rectangle of the character box, in CSS px (a DOMRect subset). */
export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

/** Client coordinates (CSS px) → a point normalized to the character box. Not clamped. */
export function normalizePoint(clientX: number, clientY: number, t: number, p: number, rect: BoxRect): Point {
  return {
    x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
    y: rect.height > 0 ? (clientY - rect.top) / rect.height : 0,
    t,
    p,
  }
}
