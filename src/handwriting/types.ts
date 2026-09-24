/** Input device that produced a stroke. Unknown pointer types are treated as mouse. */
export type PointerKind = 'touch' | 'pen' | 'mouse'

/**
 * How a kept stroke ended.
 *
 * up          — lifted normally
 * cancel      — the browser took the pointer (pointercancel: an edge-swipe or other system gesture);
 *               the ink is kept, but the stroke may be cut short
 * lost        — the lift was never seen (mouse/pen moving with no button pressed, or pointer capture
 *               lost); the stroke ends at its last sample
 * interrupted — the app ended it: input disabled (e.g. scoring), tab hidden, box detached
 */
export type StrokeEnd = 'up' | 'cancel' | 'lost' | 'interrupted'

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

/**
 * A stroke: one pen-down to pen-up. The optional fields are set on strokes written in the engine;
 * older data and synthetic strokes (tests, references) may lack them.
 */
export interface Stroke {
  points: Point[]
  pointerType: PointerKind
  /** Unique within the engine that recorded it; kept when ink is saved and loaded back. */
  id?: string
  /** When the first sample was taken, in ms since the Unix epoch (Point.t counts from here). */
  startedAt?: number
  /** How it ended. */
  end?: StrokeEnd
}

export interface Ink {
  strokes: Stroke[]
}

/** Undo history entry. Clear keeps a snapshot so it can be undone. */
export type Op = { kind: 'add'; stroke: Stroke } | { kind: 'clear'; snapshot: Stroke[] }
