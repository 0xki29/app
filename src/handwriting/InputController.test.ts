import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBox } from './fakeDom'
import { InputController } from './InputController'
import { PEN_GRACE_MS } from './inputPolicy'
import type { Point } from './types'

let box: FakeBox
let input: InputController
let log: string[]
let points: Point[]
let clock: number

beforeEach(() => {
  box = new FakeBox()
  log = []
  points = []
  clock = 0
  input = new InputController(
    box.el,
    {
      start: (p, kind) => {
        points = [p]
        log.push(`start ${kind}`)
      },
      move: (pts) => points.push(...pts),
      end: (reason) => log.push(`end ${reason}`),
      discard: (reason) => log.push(`discard ${reason}`),
    },
    { now: () => clock },
  )
})

/** A horizontal stroke from x = 0.2 to x = 0.2 + length, 16 ms per sample. */
function stroke(t: number, opts: { length?: number; id?: number; kind?: 'touch' | 'pen' | 'mouse'; up?: boolean } = {}) {
  const { length = 0.3, id = 1, kind = 'touch', up = true } = opts
  box.down({ t, id, kind, x: 0.2, y: 0.5 })
  for (let i = 1; i <= 4; i++) box.move({ t: t + i * 16, id, kind, x: 0.2 + (length * i) / 4, y: 0.5 })
  if (up) box.up({ t: t + 80, id, kind, x: 0.2 + length, y: 0.5 })
}

describe('InputController', () => {
  it('reports a normal stroke: start, samples with relative times, end up', () => {
    stroke(1000)
    expect(log).toEqual(['start touch', 'end up'])
    expect(points.map((p) => p.t)).toEqual([0, 16, 32, 48, 64])
    expect(points[4].x).toBeCloseTo(0.5)
    expect(box.captured.size).toBe(0)
  })

  describe('taps (A5)', () => {
    it('drops a quick tap that did not move', () => {
      box.down({ t: 1000 })
      box.up({ t: 1060 })
      expect(log).toEqual(['start touch', 'discard tap'])
    })

    it('drops a tap with sensor jitter: reach counts, not path length', () => {
      box.down({ t: 1000, x: 0.5 })
      for (let i = 1; i <= 6; i++) box.move({ t: 1000 + i * 8, x: 0.5 + (i % 2 ? 0.003 : 0) })
      box.up({ t: 1060, x: 0.5 })
      expect(log).toEqual(['start touch', 'discard tap'])
    })

    it('drops a mouse click', () => {
      box.down({ t: 1000, kind: 'mouse' })
      box.up({ t: 1090, kind: 'mouse' })
      expect(log).toEqual(['start mouse', 'discard tap'])
    })

    it('keeps a quick dot, which moves', () => {
      stroke(1000, { length: 0.04 })
      expect(log).toEqual(['start touch', 'end up'])
    })

    it('keeps a deliberate press held in place, with a last sample at the lift (EI-1)', () => {
      box.down({ t: 1000, x: 0.9, y: 0.9 })
      box.up({ t: 1300, x: 0.9, y: 0.9 })
      expect(log).toEqual(['start touch', 'end up'])
      // Its samples show how long it lasted, as the stroke check measures it.
      expect(points.map((p) => [p.x, p.y, p.t])).toEqual([
        [0.9, 0.9, 0],
        [0.9, 0.9, 300],
      ])
    })

    it('adds no sample to a stroke whose samples already show it', () => {
      stroke(1000)
      expect(points.map((p) => p.t)).toEqual([0, 16, 32, 48, 64])
    })

    it('drops a tap however it ends (cancel, finish)', () => {
      box.down({ t: 1000 })
      box.cancel({ t: 1050 })
      clock = 2050
      box.down({ t: 2000 })
      input.finish()
      expect(log).toEqual(['start touch', 'discard tap', 'start touch', 'discard tap'])
    })

    it('finish() drops a still contact however long it was held: a thumb resting on the box is no stroke', () => {
      box.down({ t: 1000 })
      box.move({ t: 1200, x: 0.501 })
      clock = 1600
      input.finish()
      expect(log).toEqual(['start touch', 'discard tap'])
    })
  })

  describe('end reasons (A10, lost pointerup)', () => {
    it('pointercancel keeps the stroke as cancel', () => {
      stroke(1000, { up: false })
      box.cancel({ t: 1100 })
      expect(log).toEqual(['start touch', 'end cancel'])
    })

    it('lost pointer capture keeps the stroke as lost', () => {
      stroke(1000, { up: false })
      box.lostCapture({ t: 1100 })
      expect(log).toEqual(['start touch', 'end lost'])
    })

    it('a mouse moving with no button pressed ends the stroke as lost, without the hover samples', () => {
      stroke(1000, { kind: 'mouse', up: false })
      const n = points.length
      box.move({ t: 1100, kind: 'mouse', buttons: 0, x: 0.9 })
      box.move({ t: 1116, kind: 'mouse', buttons: 0, x: 0.95 })
      expect(log).toEqual(['start mouse', 'end lost'])
      expect(points).toHaveLength(n)
    })

    it('the same for a pen', () => {
      stroke(1000, { kind: 'pen', up: false })
      box.move({ t: 1100, kind: 'pen', buttons: 0 })
      expect(log).toEqual(['start pen', 'end lost'])
    })

    it('a mouse dragged on with only the right button, after the left one was released (EI-3)', () => {
      stroke(1000, { kind: 'mouse', up: false })
      const n = points.length
      box.move({ t: 1100, kind: 'mouse', buttons: 2, x: 0.9, y: 0.9 })
      expect(log).toEqual(['start mouse', 'end lost'])
      expect(points).toHaveLength(n)
    })

    it('the mouse down again without an up: the old stroke ends as lost, a new one starts (EI-3)', () => {
      stroke(1000, { kind: 'mouse', up: false })
      box.down({ t: 1200, kind: 'mouse', x: 0.8, y: 0.9 })
      expect(log).toEqual(['start mouse', 'end lost', 'start mouse'])
      expect(points).toHaveLength(1)
      expect(points[0].x).toBeCloseTo(0.8)
    })

    it('a pen with a new pointer id after a lost pointerup starts a new stroke instead of being ignored (EI-3)', () => {
      stroke(1000, { kind: 'pen', id: 5, up: false })
      stroke(1200, { kind: 'pen', id: 6 })
      expect(log).toEqual(['start pen', 'end lost', 'start pen', 'end up'])
      expect(input.active).toBe(false)
    })

    it('not for a device that reports no buttons at all', () => {
      box.down({ t: 1000, kind: 'pen', buttons: 0, x: 0.2 })
      for (let i = 1; i <= 4; i++) box.move({ t: 1000 + i * 16, kind: 'pen', buttons: 0, x: 0.2 + i * 0.05 })
      box.up({ t: 1080, kind: 'pen', x: 0.4 })
      expect(log).toEqual(['start pen', 'end up'])
      expect(points).toHaveLength(5)
    })

    it('finish() ends the stroke as interrupted, and the rest of that contact is ignored', () => {
      stroke(1000, { up: false })
      clock = 1100
      input.finish()
      const n = points.length
      box.move({ t: 1116, x: 0.9 })
      box.up({ t: 1130, x: 0.9 })
      expect(log).toEqual(['start touch', 'end interrupted'])
      expect(points).toHaveLength(n)
      expect(input.active).toBe(false)
    })

    it('finish() without a stroke does nothing', () => {
      input.finish()
      expect(log).toEqual([])
    })

    it('cancel() drops the pointer silently', () => {
      stroke(1000, { up: false })
      input.cancel()
      box.up({ t: 1100 })
      expect(log).toEqual(['start touch'])
    })
  })

  describe('pen priority (A9)', () => {
    it('ignores touch just after a pen stroke', () => {
      stroke(1000, { kind: 'pen', id: 2 })
      stroke(1500)
      expect(log).toEqual(['start pen', 'end up'])
    })

    it('lets touch write again once the pen has been idle long enough', () => {
      stroke(1000, { kind: 'pen', id: 2 })
      stroke(1080 + PEN_GRACE_MS)
      expect(log).toEqual(['start pen', 'end up', 'start touch', 'end up'])
      expect(input.penSeen).toBe(true)
    })

    it('a hovering pen keeps touch blocked', () => {
      stroke(1000, { kind: 'pen', id: 2 })
      box.move({ t: 2400, kind: 'pen', id: 2, buttons: 0 })
      stroke(2400 + PEN_GRACE_MS - 100)
      expect(log).toEqual(['start pen', 'end up'])
    })

    it('ignores touch while the pen is writing', () => {
      stroke(1000, { kind: 'pen', id: 2, up: false })
      box.down({ t: 1060, id: 3 })
      expect(log).toEqual(['start pen'])
    })

    it('a pen landing during a touch stroke drops that touch as a palm', () => {
      stroke(1000, { up: false })
      box.down({ t: 1200, kind: 'pen', id: 2 })
      expect(log).toEqual(['start touch', 'discard palm', 'start pen'])
    })
  })

  describe('palm rejection (A10)', () => {
    it('a second touch takes over from a touch that landed just before and has not moved', () => {
      box.down({ t: 1000, id: 1, x: 0.8, y: 0.9 })
      box.move({ t: 1030, id: 1, x: 0.801, y: 0.9 })
      stroke(1100, { id: 2 })
      box.move({ t: 1200, id: 1, x: 0.7, y: 0.9 })
      box.up({ t: 1300, id: 1 })
      expect(log).toEqual(['start touch', 'discard palm', 'start touch', 'end up'])
    })

    it('the finger that landed first keeps writing when a still touch lands next to it (EI-2)', () => {
      box.down({ t: 1000, id: 1, x: 0.45, y: 0.12 })
      box.move({ t: 1010, id: 1, x: 0.453, y: 0.12 })
      box.down({ t: 1026, id: 2, x: 0.9, y: 0.95, width: 30, height: 30 })
      for (let i = 1; i <= 4; i++) box.move({ t: 1026 + i * 16, id: 1, x: 0.453 + i * 0.02, y: 0.12 })
      box.up({ t: 1110, id: 1, x: 0.533, y: 0.12 })
      box.up({ t: 1300, id: 2, x: 0.9, y: 0.95 })
      expect(log).toEqual(['start touch', 'end up'])
      expect(points[points.length - 1].x).toBeCloseTo(0.533)
      expect(box.captured.size).toBe(0)
    })

    it('a hand edge resting longer than TAKEOVER_MAX_MS does not block the finger, and leaves no dot (EI-2)', () => {
      box.down({ t: 1000, id: 1, x: 0.9, y: 0.95, width: 50, height: 50 })
      stroke(1400, { id: 2 })
      box.up({ t: 1600, id: 1, x: 0.9, y: 0.95 })
      expect(log).toEqual(['start touch', 'discard palm', 'start touch', 'end up'])
      // The finger's stroke from its first sample on: the samples it made while watched are kept.
      expect(points.map((p) => p.t)).toEqual([0, 16, 32, 48, 64])
      expect(points[0].x).toBeCloseTo(0.2)
    })

    it('a still touch lifted while another is down is dropped, and the other may write', () => {
      box.down({ t: 1000, id: 1, x: 0.9, y: 0.95 })
      box.down({ t: 1100, id: 2, x: 0.2, y: 0.5 })
      box.up({ t: 1400, id: 1, x: 0.9, y: 0.95 })
      for (let i = 1; i <= 4; i++) box.move({ t: 1400 + i * 16, id: 2, x: 0.2 + i * 0.05, y: 0.5 })
      box.up({ t: 1480, id: 2, x: 0.4, y: 0.5 })
      expect(log).toEqual(['start touch', 'discard palm', 'start touch', 'end up'])
    })

    it('two still touches leave nothing behind', () => {
      box.down({ t: 1000, id: 1, x: 0.9, y: 0.95 })
      box.down({ t: 1100, id: 2, x: 0.1, y: 0.95 })
      box.up({ t: 1500, id: 2, x: 0.1, y: 0.95 })
      box.up({ t: 1700, id: 1, x: 0.9, y: 0.95 })
      expect(log).toEqual(['start touch', 'discard palm'])
      expect(box.captured.size).toBe(0)
    })

    it('a second touch cannot interrupt a stroke being written', () => {
      stroke(1000, { up: false })
      box.down({ t: 1070, id: 2 })
      box.up({ t: 1100, id: 2 })
      box.up({ t: 1120 })
      expect(log).toEqual(['start touch', 'end up'])
    })

    it('ignores a touch with a palm-sized contact', () => {
      box.down({ t: 1000, width: 150, height: 110 })
      box.up({ t: 1400 })
      expect(log).toEqual([])
    })

    it('drops a young still touch whose contact grows to palm size', () => {
      box.down({ t: 1000, width: 30, height: 30 })
      box.move({ t: 1040, width: 120, height: 100, x: 0.501 })
      expect(log).toEqual(['start touch', 'discard palm'])
    })

    it('keeps a stroke whose contact grows once it is clearly writing', () => {
      stroke(1000, { up: false })
      box.move({ t: 1100, width: 120, height: 100, x: 0.6 })
      box.up({ t: 1120, x: 0.6 })
      expect(log).toEqual(['start touch', 'end up'])
    })
  })

  it('ignores other buttons and input while disabled', () => {
    box.down({ t: 1000, kind: 'mouse', button: 2 })
    input.enabled = false
    box.down({ t: 1100 })
    expect(log).toEqual([])
  })

  it('destroy() removes every listener', () => {
    input.destroy()
    expect(box.listenerCount()).toBe(0)
  })
})
