import type { Ink, Op, Point, PointerKind, Stroke, StrokeEnd } from './types'

/**
 * Source of truth for the ink in one character box: committed strokes + undo history.
 * Pure (no DOM, no rendering) — every canvas is a projection of this model.
 *
 * `revision` identifies the current strokes: it increases on every change to them and is never
 * reused, so anything computed from a copy of the ink (scores, stroke colors) can tell whether it
 * still applies.
 */
export class InkModel {
  private current: Stroke[] = []
  private history: Op[] = []
  private rev = 0

  /** The committed strokes, for drawing. Not copies: use toInk() for anything that keeps them. */
  get strokes(): readonly Stroke[] {
    return this.current
  }

  get strokeCount(): number {
    return this.current.length
  }

  get canUndo(): boolean {
    return this.history.length > 0
  }

  get revision(): number {
    return this.rev
  }

  /** Appends a stroke, undoably. The model keeps the object: the caller must not change it later. */
  add(stroke: Stroke): boolean {
    if (stroke.points.length === 0) return false
    this.current.push(stroke)
    this.history.push({ kind: 'add', stroke })
    this.rev++
    return true
  }

  /** Removes every stroke, undoably. No-op on empty ink so Undo never "restores nothing". */
  clear(): boolean {
    if (this.current.length === 0) return false
    this.history.push({ kind: 'clear', snapshot: this.current })
    this.current = []
    this.rev++
    return true
  }

  undo(): boolean {
    const op = this.history.pop()
    if (!op) return false
    if (op.kind === 'add') this.current.pop()
    else this.current = op.snapshot
    this.rev++
    return true
  }

  /** Drops strokes and history, e.g. when moving to another character. Not undoable. */
  reset(): void {
    if (this.current.length > 0) this.rev++
    this.current = []
    this.history = []
  }

  /**
   * Replaces the ink with a validated copy of `ink` (restoring saved work, replay) and drops the
   * history: loading is not an edit the learner can undo. Throws a TypeError, leaving the model
   * unchanged, if `ink` is not valid ink (see parseInk).
   */
  load(ink: Ink): void {
    const { strokes } = parseInk(ink)
    this.current = strokes
    this.history = []
    this.rev++
  }

  /** A deep copy: callers can keep or change it without touching the model. */
  toInk(): Ink {
    return { strokes: this.current.map(cloneStroke) }
  }
}

export function cloneStroke(s: Stroke): Stroke {
  const copy: Stroke = { points: s.points.map(clonePoint), pointerType: s.pointerType }
  if (s.id !== undefined) copy.id = s.id
  if (s.startedAt !== undefined) copy.startedAt = s.startedAt
  if (s.end !== undefined) copy.end = s.end
  return copy
}

function clonePoint(p: Point): Point {
  return { x: p.x, y: p.y, t: p.t, p: p.p }
}

const POINTER_KINDS: readonly PointerKind[] = ['touch', 'pen', 'mouse']
const STROKE_ENDS: readonly StrokeEnd[] = ['up', 'cancel', 'lost', 'interrupted']

/**
 * Validates untrusted ink (saved data, JSON, structured clones) and returns a clean deep copy with
 * only the known fields. Every stroke needs at least one point; every coordinate, time and pressure
 * must be a finite number. Throws a TypeError naming the first bad field. A hole in an array (a
 * sparse array, which structured clone keeps) is a missing stroke or point: `Array.from` visits it
 * as undefined, where `map` would skip it and return the hole.
 */
export function parseInk(value: unknown): Ink {
  if (!isObject(value) || !Array.isArray(value.strokes)) fail('ink', 'an object with a strokes array')
  return { strokes: Array.from(value.strokes as unknown[], (s, i) => parseStroke(s, `strokes[${i}]`)) }
}

function parseStroke(value: unknown, path: string): Stroke {
  if (!isObject(value)) fail(path, 'a stroke object')
  const { points, pointerType, id, startedAt, end } = value
  if (!Array.isArray(points) || points.length === 0) fail(`${path}.points`, 'a non-empty array')
  if (!POINTER_KINDS.includes(pointerType as PointerKind)) fail(`${path}.pointerType`, POINTER_KINDS.join(' | '))
  const stroke: Stroke = {
    points: Array.from(points as unknown[], (p, i) => parsePoint(p, `${path}.points[${i}]`)),
    pointerType: pointerType as PointerKind,
  }
  if (id !== undefined) {
    if (typeof id !== 'string') fail(`${path}.id`, 'a string')
    stroke.id = id
  }
  if (startedAt !== undefined) {
    if (!isFiniteNumber(startedAt)) fail(`${path}.startedAt`, 'a finite number')
    stroke.startedAt = startedAt
  }
  if (end !== undefined) {
    if (!STROKE_ENDS.includes(end as StrokeEnd)) fail(`${path}.end`, STROKE_ENDS.join(' | '))
    stroke.end = end as StrokeEnd
  }
  return stroke
}

function parsePoint(value: unknown, path: string): Point {
  if (!isObject(value)) fail(path, 'a point object')
  const { x, y, t, p } = value
  for (const [key, v] of [['x', x], ['y', y], ['t', t], ['p', p]] as const) {
    if (!isFiniteNumber(v)) fail(`${path}.${key}`, 'a finite number')
  }
  return { x: x as number, y: y as number, t: t as number, p: p as number }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function fail(path: string, expected: string): never {
  throw new TypeError(`Invalid ink: ${path} must be ${expected}`)
}
