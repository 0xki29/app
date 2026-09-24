import { describe, expect, it } from 'vitest'
import { InkModel, parseInk } from './InkModel'
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

  it('toInk is a deep copy: changing it never reaches the model', () => {
    const m = new InkModel()
    m.add({ ...stroke(1), id: 'a-1', startedAt: 1000, end: 'up' })
    const ink = m.toInk()
    ink.strokes[0].points[0].x = 42
    ink.strokes[0].points.pop()
    ink.strokes[0].end = 'lost'
    expect(m.toInk()).toEqual({ strokes: [{ ...stroke(1), id: 'a-1', startedAt: 1000, end: 'up' }] })
  })

  it('copies leave out optional fields a stroke does not have', () => {
    const m = new InkModel()
    m.add(stroke(1))
    expect(Object.keys(m.toInk().strokes[0]).sort()).toEqual(['pointerType', 'points'])
  })
})

describe('InkModel revision', () => {
  it('increases on every change to the strokes, and only then', () => {
    const m = new InkModel()
    const seen = [m.revision]
    m.add(stroke(1))
    seen.push(m.revision)
    m.add({ pointerType: 'mouse', points: [] }) // ignored
    seen.push(m.revision)
    m.clear()
    seen.push(m.revision)
    m.clear() // already empty
    seen.push(m.revision)
    m.undo() // restores the clear
    seen.push(m.revision)
    m.undo() // removes the stroke
    seen.push(m.revision)
    m.undo() // nothing left
    seen.push(m.revision)
    m.reset() // empty: no change
    seen.push(m.revision)
    m.add(stroke(2))
    m.reset()
    seen.push(m.revision)
    expect(seen).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 4, 6])
  })

  it('is never reused, so equal counts at different times are told apart', () => {
    const m = new InkModel()
    m.add(stroke(1))
    const first = m.revision
    m.undo()
    m.add(stroke(1))
    expect(m.strokeCount).toBe(1)
    expect(m.revision).not.toBe(first)
  })
})

describe('InkModel.load', () => {
  it('replaces the strokes with a copy, drops history, bumps the revision', () => {
    const m = new InkModel()
    m.add(stroke(1))
    const saved = { strokes: [stroke(2), { ...stroke(3), id: 'x-9', startedAt: 1_700_000_000_000, end: 'cancel' as const }] }
    m.load(saved)
    expect(m.toInk()).toEqual(saved)
    expect(m.canUndo).toBe(false)
    expect(m.revision).toBe(2)
    saved.strokes[0].points[0].x = 42
    expect(m.strokes[0].points[0].x).toBe(0.2)
  })

  it('loads empty ink', () => {
    const m = new InkModel()
    m.add(stroke(1))
    m.load({ strokes: [] })
    expect(m.strokeCount).toBe(0)
  })

  it('rejects invalid ink and leaves the model unchanged', () => {
    const m = new InkModel()
    m.add(stroke(1))
    const bad = { strokes: [stroke(2), { pointerType: 'touch', points: [{ x: 0, y: Infinity, t: 0, p: 0.5 }] }] }
    expect(() => m.load(bad as never)).toThrow(/strokes\[1\]\.points\[0\]\.y must be a finite number/)
    expect(m.toInk()).toEqual({ strokes: [stroke(1)] })
    expect(m.revision).toBe(1)
    expect(m.canUndo).toBe(true)
  })
})

describe('parseInk', () => {
  const point = { x: 0.1, y: 0.2, t: 0, p: 0.5 }

  it('keeps known fields only', () => {
    const ink = parseInk({ strokes: [{ pointerType: 'pen', points: [{ ...point, extra: 1 }], id: 's', color: 'red' }], v: 2 })
    expect(ink).toEqual({ strokes: [{ pointerType: 'pen', points: [point], id: 's' }] })
  })

  it.each([
    ['not an object', null, /ink must be/],
    ['no strokes array', { strokes: 'x' }, /ink must be/],
    ['a stroke without points', { strokes: [{ pointerType: 'touch', points: [] }] }, /strokes\[0\]\.points/],
    ['an unknown pointer type', { strokes: [{ pointerType: 'finger', points: [point] }] }, /pointerType/],
    ['a non-numeric coordinate', { strokes: [{ pointerType: 'touch', points: [{ ...point, x: '1' }] }] }, /\.x must be a finite number/],
    ['NaN pressure', { strokes: [{ pointerType: 'touch', points: [{ ...point, p: NaN }] }] }, /\.p must be/],
    ['a missing time', { strokes: [{ pointerType: 'touch', points: [{ x: 0, y: 0, p: 0.5 }] }] }, /\.t must be/],
    ['a numeric id', { strokes: [{ pointerType: 'touch', points: [point], id: 7 }] }, /\.id must be a string/],
    ['a non-finite start time', { strokes: [{ pointerType: 'touch', points: [point], startedAt: Infinity }] }, /startedAt/],
    ['an unknown end', { strokes: [{ pointerType: 'touch', points: [point], end: 'discard' }] }, /\.end must be/],
  ])('rejects %s', (_, value, message) => {
    expect(() => parseInk(value)).toThrow(TypeError)
    expect(() => parseInk(value)).toThrow(message)
  })

  it('rejects holes in sparse arrays (structured clone keeps them), in strokes and in points (EI-4)', () => {
    const stroke = { pointerType: 'touch', points: [point] }
    const strokes: unknown[] = new Array(2)
    strokes[1] = stroke
    expect(() => parseInk({ strokes })).toThrow(/strokes\[0\] must be a stroke object/)
    const points: unknown[] = new Array(2)
    points[1] = point
    expect(() => parseInk({ strokes: [{ ...stroke, points }] })).toThrow(/strokes\[0\]\.points\[0\] must be a point object/)
  })
})
