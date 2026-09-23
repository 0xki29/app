import { describe, expect, it } from 'vitest'
import { InkModel } from './InkModel'
import type { Stroke } from './types'

function stroke(id: number, n = 3): Stroke {
  return {
    pointerType: 'touch',
    points: Array.from({ length: n }, (_, i) => ({ x: id / 10, y: i / 10, t: i * 8, p: 0.5 })),
  }
}

describe('InkModel', () => {
  it('starts empty with nothing to undo', () => {
    const m = new InkModel()
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(false)
    expect(m.undo()).toBe(false)
    expect(m.toInk()).toEqual({ strokes: [] })
  })

  it('clear on empty ink is a no-op and adds no history', () => {
    const m = new InkModel()
    expect(m.clear()).toBe(false)
    expect(m.canUndo).toBe(false)
  })

  it('adds strokes in order', () => {
    const m = new InkModel()
    const a = stroke(1)
    const b = stroke(2)
    expect(m.add(a)).toBe(true)
    m.add(b)
    expect(m.strokes).toEqual([a, b])
    expect(m.canUndo).toBe(true)
  })

  it('ignores strokes without points', () => {
    const m = new InkModel()
    expect(m.add({ pointerType: 'mouse', points: [] })).toBe(false)
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(false)
  })

  it('undo removes the most recent stroke', () => {
    const m = new InkModel()
    const a = stroke(1)
    m.add(a)
    m.add(stroke(2))
    expect(m.undo()).toBe(true)
    expect(m.strokes).toEqual([a])
    m.undo()
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(false)
  })

  it('clear removes all strokes', () => {
    const m = new InkModel()
    m.add(stroke(1))
    m.add(stroke(2))
    expect(m.clear()).toBe(true)
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(true)
  })

  it('undo after clear restores the exact strokes in order', () => {
    const m = new InkModel()
    const a = stroke(1)
    const b = stroke(2)
    m.add(a)
    m.add(b)
    m.clear()
    expect(m.undo()).toBe(true)
    expect(m.strokes).toEqual([a, b])
    expect(m.strokes[0]).toBe(a)
  })

  it('unwinds interleaved add / clear / add history', () => {
    const m = new InkModel()
    const a = stroke(1)
    const b = stroke(2)
    m.add(a)
    m.clear()
    m.add(b)
    expect(m.strokes).toEqual([b])
    m.undo() // remove b
    expect(m.strokeCount).toBe(0)
    m.undo() // undo clear
    expect(m.strokes).toEqual([a])
    m.undo() // remove a
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(false)
  })

  it('reset drops strokes and history', () => {
    const m = new InkModel()
    m.add(stroke(1))
    m.clear()
    m.add(stroke(2))
    m.reset()
    expect(m.strokeCount).toBe(0)
    expect(m.canUndo).toBe(false)
  })

  it('toInk returns a copy that later edits do not mutate', () => {
    const m = new InkModel()
    m.add(stroke(1))
    const ink = m.toInk()
    m.add(stroke(2))
    expect(ink.strokes).toHaveLength(1)
  })
})
