/** Input device that produced a stroke. Unknown pointer types are treated as mouse. */
export type PointerKind = 'touch' | 'pen' | 'mouse'

/**
 * One sample of a stroke.
 *
 * x, y — normalized to the square character box: (0,0) top-left, (1,1) bottom-right.
 *        Not clamped: a pointer that leaves the box mid-stroke yields values outside [0,1].
 * t    — ms since the stroke's first sample.
 * p    — raw PointerEvent.pressure (browsers report 0.5 for hardware without pressure).
 */
export interface Point {
  x: number
  y: number
  t: number
  p: number
}

export interface Stroke {
  points: Point[]
  pointerType: PointerKind
}

export interface Ink {
  strokes: Stroke[]
}

/** Undo history entry. Clear keeps a snapshot so it can be undone. */
export type Op = { kind: 'add'; stroke: Stroke } | { kind: 'clear'; snapshot: Stroke[] }
