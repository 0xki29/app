import type { Ink, Op, Stroke } from './types'

/**
 * Source of truth for the ink in one character box: committed strokes + undo history.
 * Pure (no DOM, no rendering) — every canvas is a projection of this model.
 */
export class InkModel {
  private current: Stroke[] = []
  private history: Op[] = []

  get strokes(): readonly Stroke[] {
    return this.current
  }

  get strokeCount(): number {
    return this.current.length
  }

  get canUndo(): boolean {
    return this.history.length > 0
  }

  add(stroke: Stroke): boolean {
    if (stroke.points.length === 0) return false
    this.current.push(stroke)
    this.history.push({ kind: 'add', stroke })
    return true
  }

  /** Removes every stroke, undoably. No-op on empty ink so Undo never "restores nothing". */
  clear(): boolean {
    if (this.current.length === 0) return false
    this.history.push({ kind: 'clear', snapshot: this.current })
    this.current = []
    return true
  }

  undo(): boolean {
    const op = this.history.pop()
    if (!op) return false
    if (op.kind === 'add') this.current.pop()
    else this.current = op.snapshot
    return true
  }

  /** Drops strokes and history, e.g. when moving to another character. Not undoable. */
  reset(): void {
    this.current = []
    this.history = []
  }

  toInk(): Ink {
    return { strokes: [...this.current] }
  }
}
