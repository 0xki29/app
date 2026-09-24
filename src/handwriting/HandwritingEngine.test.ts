import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkStrokes } from '../strokes/strokeCheck'
import { fixtureStrokeData as peekStrokeData } from '../test/fixtures/strokes'
import { fakeCanvas, FakeBox, FakeDocument, fakeGlobals } from './fakeDom'
import { HandwritingEngine, type StrokeCommit } from './HandwritingEngine'
import type { Ink, Stroke } from './types'

let doc: FakeDocument

beforeEach(() => {
  doc = new FakeDocument()
  for (const [name, value] of Object.entries(fakeGlobals(doc))) vi.stubGlobal(name, value)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function attached(context: 'ok' | 'null' | 'throw' = 'ok') {
  const engine = new HandwritingEngine()
  const box = new FakeBox()
  const detach = engine.attach({
    box: box.el,
    staticCanvas: fakeCanvas(context),
    liveCanvas: fakeCanvas(context),
    tailCanvas: fakeCanvas(context),
  })
  const phases: string[] = []
  engine.onStrokePhase((phase, detail) => phases.push(detail ? `${phase} ${detail}` : phase))
  return { engine, box, detach, phases }
}

/**
 * Event times near performance.now(), which the engine uses for strokes it ends itself.
 * A horizontal stroke from x = 0.2, 16 ms per sample.
 */
function write(box: FakeBox, opts: { t?: number; length?: number; id?: number; kind?: 'touch' | 'pen' | 'mouse'; up?: boolean } = {}) {
  const { t = performance.now(), length = 0.3, id = 1, kind = 'touch', up = true } = opts
  box.down({ t, id, kind, x: 0.2 })
  for (let i = 1; i <= 4; i++) box.move({ t: t + i * 16, id, kind, x: 0.2 + (length * i) / 4 })
  if (up) box.up({ t: t + 80, id, kind, x: 0.2 + length })
}

function stroke(x: number): Stroke {
  return { pointerType: 'touch', points: [0, 1, 2].map((i) => ({ x, y: i / 10, t: i * 8, p: 0.5 })) }
}

describe('HandwritingEngine — committed strokes', () => {
  it('records id, start time and end reason; point times stay relative', () => {
    const { engine, box } = attached()
    const t = performance.now()
    write(box, { t })
    const [s] = engine.getInk().strokes
    expect(s.end).toBe('up')
    expect(s.id).toMatch(/^[0-9a-z]{6}-1$/)
    expect(s.startedAt).toBe(Math.round(performance.timeOrigin + t))
    // Rounded: t is a difference of fractional event times.
    expect(s.points.map((p) => Math.round(p.t))).toEqual([0, 16, 32, 48, 64])
  })

  it('accepts event times that are already epoch ms (old engines)', () => {
    const { engine, box } = attached()
    write(box, { t: 1_700_000_000_123.4 })
    expect(engine.getInk().strokes[0].startedAt).toBe(1_700_000_000_123)
  })

  it('gives every stroke its own id', () => {
    const { engine, box } = attached()
    for (let i = 0; i < 3; i++) write(box)
    const ids = engine.getInk().strokes.map((s) => s.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('notifies onStrokeCommitted with a copy, its index and revision, after publishing', () => {
    const { engine, box } = attached()
    const commits: StrokeCommit[] = []
    let snapshotRevision = -1
    engine.onStrokeCommitted((c) => {
      commits.push(c)
      snapshotRevision = engine.getSnapshot().inkRevision
    })
    write(box)
    write(box)
    expect(commits.map((c) => c.index)).toEqual([0, 1])
    expect(commits[1].revision).toBe(engine.getSnapshot().inkRevision)
    expect(snapshotRevision).toBe(commits[1].revision)
    commits[0].stroke.points.length = 0
    expect(engine.getInk().strokes[0].points).toHaveLength(5)
  })

  it('stroke phases: start → end with the reason', () => {
    const { box, phases } = attached()
    write(box)
    expect(phases).toEqual(['start', 'end up'])
  })
})

describe('HandwritingEngine — dropped contacts (A5, A10)', () => {
  it('a tap never reaches the ink: discard, no end, no commit, no snapshot change', () => {
    const { engine, box, phases } = attached()
    const commits = vi.fn()
    const listener = vi.fn()
    engine.onStrokeCommitted(commits)
    engine.subscribe(listener)
    const before = engine.getSnapshot()
    const t = performance.now()
    box.down({ t })
    box.up({ t: t + 50 })
    expect(phases).toEqual(['start', 'discard tap'])
    expect(engine.getInk().strokes).toHaveLength(0)
    expect(commits).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(engine.getSnapshot()).toBe(before)
    expect(engine.stats).toMatchObject({ lastEnd: 'tap', discarded: 1, drawing: false })
  })

  it('a palm replaced by the writing finger is dropped', () => {
    const { engine, box, phases } = attached()
    const t = performance.now()
    box.down({ t, id: 7, x: 0.9, y: 0.9 })
    write(box, { t: t + 100, id: 8 })
    expect(phases).toEqual(['start', 'discard palm', 'start', 'end up'])
    expect(engine.getInk().strokes).toHaveLength(1)
  })

  it('a still contact landing just after the finger neither steals its stroke nor becomes a dot (EI-2)', () => {
    const { engine, box, phases } = attached()
    const t = performance.now()
    box.down({ t, id: 1, x: 0.45, y: 0.12 })
    box.move({ t: t + 10, id: 1, x: 0.453, y: 0.12 })
    box.down({ t: t + 26, id: 2, x: 0.9, y: 0.95, width: 30, height: 30 })
    for (let i = 1; i <= 4; i++) box.move({ t: t + 26 + i * 16, id: 1, x: 0.453 + i * 0.02, y: 0.12 })
    box.up({ t: t + 110, id: 1, x: 0.533, y: 0.12 })
    box.up({ t: t + 400, id: 2, x: 0.9, y: 0.95 })
    expect(phases).toEqual(['start', 'end up'])
    const [s] = engine.getInk().strokes
    expect(s.points[0].x).toBeCloseTo(0.45)
    expect(engine.getInk().strokes).toHaveLength(1)
  })

  it('reset() mid-stroke drops the stroke with reason reset', () => {
    const { engine, box, phases } = attached()
    write(box, { up: false })
    engine.reset()
    box.up({ t: performance.now() + 100 })
    expect(phases).toEqual(['start', 'discard reset'])
    expect(engine.getInk().strokes).toHaveLength(0)
  })
})

describe('HandwritingEngine — ending strokes from the app side', () => {
  it('flushInput() commits the stroke in progress, so the ink read next includes it (B2-race)', () => {
    const { engine, box, phases } = attached()
    write(box, { up: false })
    expect(engine.getInk().strokes).toHaveLength(0)
    engine.flushInput()
    const ink = engine.getInk()
    expect(ink.strokes).toHaveLength(1)
    expect(ink.strokes[0].end).toBe('interrupted')
    expect(ink.revision).toBe(engine.getSnapshot().inkRevision)
    // The rest of that contact is not writing.
    box.move({ t: performance.now() + 100, x: 0.9 })
    box.up({ t: performance.now() + 120, x: 0.9 })
    expect(engine.getInk().strokes).toHaveLength(1)
    expect(phases).toEqual(['start', 'end interrupted'])
  })

  it('flushInput() drops a stroke that is still only a tap', () => {
    const { engine, box, phases } = attached()
    box.down({ t: performance.now() })
    engine.flushInput()
    expect(phases).toEqual(['start', 'discard tap'])
    expect(engine.getInk().strokes).toHaveLength(0)
  })

  it('flushInput() drops a still contact however long it was held: a thumb resting on the box when "Chấm điểm" is pressed', () => {
    const { engine, box, phases } = attached()
    box.down({ t: performance.now() - 500 })
    engine.flushInput()
    expect(phases).toEqual(['start', 'discard tap'])
    expect(engine.getInk().strokes).toHaveLength(0)
  })

  it('a still press held and lifted is one stroke to the engine and to the stroke check alike (EI-1)', () => {
    const { engine, box } = attached()
    const t = performance.now()
    box.down({ t, x: 0.93, y: 0.93 })
    box.up({ t: t + 300, x: 0.93, y: 0.93 })
    const ink = engine.getInk()
    expect(ink.strokes).toHaveLength(1)
    expect(ink.strokes[0].points.map((p) => Math.round(p.t))).toEqual([0, 300])
    for (const mode of ['trace', 'recall'] as const) {
      const check = checkStrokes(ink, peekStrokeData('永')!, mode)
      // Not a tap: far from every stroke, it is an extra one, which the review says.
      expect(check.user[0]).toEqual({ verdict: 'wrong', issue: 'extra', ref: null })
    }
  })

  it('disabling input ends the stroke as interrupted, not up', () => {
    const { engine, box } = attached()
    write(box, { up: false })
    engine.setInputEnabled(false)
    expect(engine.getInk().strokes[0].end).toBe('interrupted')
  })

  it('hiding the tab ends the stroke as interrupted', () => {
    const { engine, box } = attached()
    write(box, { up: false })
    doc.setVisibility('hidden')
    expect(engine.getInk().strokes[0].end).toBe('interrupted')
  })

  it('a lost pointerup ends a mouse stroke as lost', () => {
    const { engine, box } = attached()
    write(box, { kind: 'mouse', up: false })
    box.move({ t: performance.now() + 200, kind: 'mouse', buttons: 0, x: 0.9 })
    const [s] = engine.getInk().strokes
    expect(s.end).toBe('lost')
    expect(s.points).toHaveLength(5)
  })

  it('a cancelled stroke keeps its reason', () => {
    const { engine, box } = attached()
    write(box, { up: false })
    box.cancel({ t: performance.now() + 100 })
    expect(engine.getInk().strokes[0].end).toBe('cancel')
  })
})

describe('HandwritingEngine — ink access and revisions', () => {
  it('getInk() is a deep copy', () => {
    const engine = new HandwritingEngine()
    engine.setInk({ strokes: [stroke(0.1)] })
    const ink = engine.getInk()
    ink.strokes[0].points[0].x = 99
    ink.strokes.push(stroke(0.2))
    expect(engine.getInk().strokes).toEqual([stroke(0.1)])
  })

  it('the revision increases on every ink change and nothing else', () => {
    const { engine, box } = attached()
    const revisions = [engine.getSnapshot().inkRevision]
    const note = () => revisions.push(engine.getSnapshot().inkRevision)
    write(box)
    note()
    engine.setSettings({ strokeWidth: 0.05 })
    engine.setInputEnabled(false)
    engine.setInputEnabled(true)
    note()
    engine.undo()
    note()
    engine.undo() // nothing to undo
    note()
    write(box)
    engine.clear()
    note()
    engine.undo()
    note()
    engine.reset()
    note()
    engine.reset() // already empty
    note()
    expect(revisions).toEqual([0, 1, 1, 2, 2, 4, 5, 6, 6])
  })

  it('setInk() loads validated ink: redraw and publish, no undo entry', () => {
    const engine = new HandwritingEngine()
    const listener = vi.fn()
    engine.subscribe(listener)
    const saved: Ink = { strokes: [{ ...stroke(0.1), id: 'old-1', end: 'up', startedAt: 1_700_000_000_000 }] }
    engine.setInk(saved)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(engine.getSnapshot()).toMatchObject({ strokeCount: 1, canUndo: false, inkRevision: 1 })
    expect(engine.getInk().strokes).toEqual(saved.strokes)
    saved.strokes[0].points[0].x = 5
    expect(engine.getInk().strokes[0].points[0].x).toBe(0.1)
  })

  it('setInk() rejects invalid ink and changes nothing', () => {
    const engine = new HandwritingEngine()
    engine.setInk({ strokes: [stroke(0.1)] })
    const bad = { strokes: [{ ...stroke(0.2), points: [{ x: NaN, y: 0, t: 0, p: 0.5 }] }] }
    expect(() => engine.setInk(bad)).toThrow(TypeError)
    expect(engine.getInk()).toEqual({ strokes: [stroke(0.1)], revision: 1 })
  })

  it('setInk() rejects sparse arrays before touching the model or the canvas (EI-4)', () => {
    const { engine } = attached()
    engine.setInk({ strokes: [stroke(0.1)] })
    const points: Stroke['points'] = new Array<Stroke['points'][number]>(2)
    points[1] = { x: 0.2, y: 0.2, t: 0, p: 0.5 }
    const strokes: Stroke[] = new Array<Stroke>(2)
    strokes[1] = stroke(0.3)
    for (const bad of [{ strokes: [{ ...stroke(0.2), points }] }, { strokes }]) {
      expect(() => engine.setInk(bad)).toThrow(TypeError)
      expect(engine.getInk()).toEqual({ strokes: [stroke(0.1)], revision: 1 })
      expect(engine.getSnapshot()).toMatchObject({ strokeCount: 1, inkRevision: 1 })
    }
  })

  it('setInk() during a stroke drops that stroke', () => {
    const { engine, box, phases } = attached()
    write(box, { up: false })
    engine.setInk({ strokes: [stroke(0.1)] })
    box.up({ t: performance.now() + 100 })
    expect(phases).toEqual(['start', 'discard reset'])
    expect(engine.getInk().strokes).toEqual([stroke(0.1)])
  })

  it('new strokes after setInk() do not reuse loaded ids', () => {
    const { engine, box } = attached()
    write(box)
    const ink = engine.getInk()
    // Loaded ink keeps its ids; another engine's own ids have another prefix.
    const b = attached()
    b.engine.setInk(ink)
    write(b.box)
    const ids = b.engine.getInk().strokes.map((s) => s.id)
    expect(ids[0]).toBe(ink.strokes[0].id)
    expect(new Set(ids).size).toBe(2)
  })

  it('setStrokeColors() ignores colors computed for an older revision', () => {
    const { engine, box } = attached()
    write(box)
    const ink = engine.getInk()
    write(box) // the learner wrote again while scoring ran
    expect(engine.setStrokeColors(['#0a0'], ink.revision)).toBe(false)
    expect(engine.setStrokeColors(['#0a0', '#a00'], engine.getInk().revision)).toBe(true)
    expect(engine.setStrokeColors(null)).toBe(true)
  })
})

describe('HandwritingEngine — canvas 2D unavailable (A12)', () => {
  for (const context of ['null', 'throw'] as const) {
    it(`attach() does not throw when getContext ${context === 'null' ? 'returns null' : 'throws'}: inert, canvasError`, () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const engine = new HandwritingEngine()
      const listener = vi.fn()
      engine.subscribe(listener)
      const box = new FakeBox()
      const layers = { box: box.el, staticCanvas: fakeCanvas(context), liveCanvas: fakeCanvas(context), tailCanvas: fakeCanvas(context) }
      let detach: () => void = () => {}
      expect(() => (detach = engine.attach(layers))).not.toThrow()
      expect(engine.getSnapshot().canvasError).toBe(true)
      expect(listener).toHaveBeenCalledTimes(1)
      // No input is taken.
      expect(box.listenerCount()).toBe(0)
      detach()

      // A later attach that works clears it.
      const ok = new FakeBox()
      engine.attach({ box: ok.el, staticCanvas: fakeCanvas(), liveCanvas: fakeCanvas(), tailCanvas: fakeCanvas() })
      expect(engine.getSnapshot().canvasError).toBe(false)
      write(ok)
      expect(engine.getInk().strokes).toHaveLength(1)
    })
  }

  it('detach() removes every listener it added', () => {
    const { box, detach } = attached()
    detach()
    expect(box.listenerCount()).toBe(0)
    expect(doc.listenerCount()).toBe(0)
  })
})
