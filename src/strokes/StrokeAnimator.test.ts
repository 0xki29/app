import { describe, expect, it } from 'vitest'
import { LOOP_FADE_MS, StrokeAnimator, type StrokeTarget } from './StrokeAnimator'
import { PACE } from './timeline'
import type { StrokeData } from './types'

// Medians of 450 units → 1000 ms per stroke at the slow pace (450 u/s).
// Slow loop: lead [0,600) s0 [600,1600) gap s1 [2150,3150) gap s2 [3700,4700) hold [4700,6900)
// (the last LOOP_FADE_MS of the hold fade the character out)
const DATA: StrokeData = {
  strokes: ['M0 0Z', 'M1 1Z', 'M2 2Z'],
  medians: [
    [[0, 0], [450, 0]],
    [[0, 100], [450, 100]],
    [[0, 200], [0, 650]],
  ],
}
const OTHER: StrokeData = { strokes: ['M0 0Z'], medians: [[[0, 0], [900, 0]]] }

class FakeEl {
  readonly attrs: Record<string, string> = {}
  writes = 0
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
    this.writes++
  }
  get state(): string | undefined {
    return this.attrs['data-state']
  }
  get offset(): number {
    return Number(this.attrs['stroke-dashoffset'])
  }
}

function setup(options: { reduced?: boolean } = {}) {
  let now = 1000
  let nextId = 1
  let reduced = options.reduced ?? false
  const frames = new Map<number, () => void>()
  const reducedListeners = new Set<() => void>()
  const animator = new StrokeAnimator({
    requestFrame: (cb) => {
      frames.set(nextId, cb)
      return nextId++
    },
    cancelFrame: (id) => frames.delete(id),
    now: () => now,
    reducedMotion: () => reduced,
    watchReducedMotion: (onChange) => {
      reducedListeners.add(onChange)
      return () => reducedListeners.delete(onChange)
    },
  })
  let notifications = 0
  animator.subscribe(() => notifications++)
  const els = [new FakeEl(), new FakeEl(), new FakeEl()]
  const targets: StrokeTarget[] = els.map((el) => ({ el, length: 500 }))
  return {
    animator,
    els,
    targets,
    get pendingFrames() {
      return frames.size
    },
    get notifications() {
      return notifications
    },
    get reducedWatchers() {
      return reducedListeners.size
    },
    /** The OS setting changes at runtime. */
    setReduced(value: boolean) {
      reduced = value
      for (const l of reducedListeners) l()
    },
    /** Advances the clock by `ms` in frames of `frameMs`, running the rAF callbacks. */
    advance(ms: number, frameMs = 16) {
      let left = ms
      while (left > 0) {
        const dt = Math.min(frameMs, left)
        now += dt
        left -= dt
        const due = [...frames.values()]
        frames.clear()
        for (const cb of due) cb()
      }
    },
    /** Clock moves without any frame (tab in the background). */
    idle(ms: number) {
      now += ms
    },
    states: () => els.map((el) => el.state),
  }
}

describe('StrokeAnimator', () => {
  it('has nothing to show before data arrives', () => {
    const { animator } = setup()
    expect(animator.getSnapshot()).toEqual({
      available: false,
      playing: false,
      pace: 'slow',
      stroke: 0,
      total: 0,
      complete: false,
    })
    animator.play()
    animator.next()
    expect(animator.getSnapshot().playing).toBe(false)
  })

  it('autoplays new data from the empty box, but runs frames only while attached', () => {
    const h = setup()
    h.animator.setData(DATA)
    expect(h.animator.getSnapshot()).toMatchObject({ available: true, playing: true, stroke: 0, total: 3 })
    expect(h.pendingFrames).toBe(0)
    const detach = h.animator.attach(h.targets)
    expect(h.pendingFrames).toBe(1)
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
    detach()
    expect(h.pendingFrames).toBe(0)
  })

  it('sweeps the active stroke with the dash offset and marks finished strokes done', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1100) // lead 600 + half of stroke 1
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
    expect(h.els[0].offset).toBeCloseTo(250, 0)
    expect(h.animator.getSnapshot().stroke).toBe(1)
    h.advance(600) // into the gap
    expect(h.states()).toEqual(['done', 'todo', 'todo'])
    expect(h.els[0].offset).toBe(0)
  })

  it('writes to the DOM only what changes: one offset per frame, states once per stroke', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(700)
    const before = h.els.map((el) => el.writes)
    h.advance(160) // 10 frames inside stroke 1
    expect(h.els[0].writes - before[0]).toBe(10)
    expect(h.els[1].writes - before[1]).toBe(0)
    expect(h.els[2].writes - before[2]).toBe(0)
  })

  it('notifies React about once per stroke, never per frame', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    const start = h.notifications
    h.advance(6900 - 16) // one full loop at 60 fps, up to the last frame of the hold
    // stroke 0→1→2→3 plus complete=true: 4 changes in ~430 frames.
    expect(h.notifications - start).toBe(4)
    expect(h.animator.getSnapshot()).toMatchObject({ stroke: 3, complete: true })
  })

  it('loops: after the hold it starts again from the empty box', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(6900 + 100)
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
    expect(h.animator.getSnapshot()).toMatchObject({ stroke: 0, complete: false, playing: true })
    h.advance(1000)
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
  })

  it('clamps a long frame so a hidden tab or jank does not skip strokes', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(16)
    const t = h.animator.time
    h.idle(60_000)
    h.advance(1)
    expect(h.animator.time - t).toBeLessThanOrEqual(100)
  })

  it('pause stops the loop; play resumes where it was, not where the clock is', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1000)
    h.animator.pause()
    expect(h.pendingFrames).toBe(0)
    const t = h.animator.time
    h.idle(5000)
    h.animator.play()
    expect(h.animator.getSnapshot().playing).toBe(true)
    h.advance(16)
    expect(h.animator.time).toBeCloseTo(t + 16, 6)
  })

  it('toggle switches between play and pause', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.toggle()
    expect(h.animator.getSnapshot().playing).toBe(false)
    h.animator.toggle()
    expect(h.animator.getSnapshot().playing).toBe(true)
  })

  it('next draws the next stroke from its start, then pauses with it whole; prev takes it away again', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1100) // stroke 1 half drawn
    h.animator.next()
    // The indicator goes up at once: stroke 1 is finished, stroke 2 starts from its beginning.
    expect(h.animator.getSnapshot()).toMatchObject({ playing: false, stroke: 2 })
    expect(h.animator.time).toBe(2150)
    expect(h.pendingFrames).toBe(1)
    h.advance(500)
    expect(h.states()).toEqual(['done', 'active', 'todo'])
    expect(h.els[1].offset).toBeCloseTo(250, 0)
    h.advance(600)
    // Stops at the end of the stroke (no loop) and keeps it marked as the stroke in the indicator.
    expect(h.animator.time).toBe(3150)
    expect(h.pendingFrames).toBe(0)
    expect(h.states()).toEqual(['done', 'active', 'todo'])
    expect(h.els[1].offset).toBe(0)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: false, stroke: 2, complete: false })
    h.animator.next()
    expect(h.animator.time).toBe(3700)
    h.advance(1100)
    // The whole character rests in ink.
    expect(h.states()).toEqual(['done', 'done', 'done'])
    expect(h.animator.getSnapshot()).toMatchObject({ stroke: 3, complete: true, playing: false })
    h.animator.next() // stays on the whole character
    expect(h.animator.getSnapshot().stroke).toBe(3)
    expect(h.pendingFrames).toBe(0)
    h.animator.prev()
    expect(h.states()).toEqual(['done', 'active', 'todo'])
    expect(h.animator.getSnapshot()).toMatchObject({ stroke: 2, complete: false })
    h.animator.prev()
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
    h.animator.prev()
    h.animator.prev()
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
    expect(h.animator.getSnapshot().stroke).toBe(0)
  })

  it('next from the empty box or a gap draws exactly the next stroke', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.prev() // empty box, paused
    h.animator.next()
    expect(h.animator.time).toBe(600)
    expect(h.animator.getSnapshot().stroke).toBe(1)
    h.advance(1100)
    expect(h.animator.time).toBe(1600)
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
  })

  it('pausing during a next step shows its stroke whole', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.prev()
    h.animator.next()
    h.advance(300)
    h.animator.pause()
    expect(h.animator.time).toBe(1600)
    expect(h.pendingFrames).toBe(0)
    expect(h.els[0].offset).toBe(0)
  })

  it('play during a next step plays on from there', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.prev()
    h.animator.next()
    h.advance(320)
    h.animator.toggle()
    expect(h.animator.getSnapshot().playing).toBe(true)
    h.advance(1000) // past the end of the step: it does not stop there
    expect(h.animator.time).toBeCloseTo(1920, 6)
    expect(h.pendingFrames).toBe(1)
  })

  it('reduced motion: next shows the stroke at once', () => {
    const h = setup({ reduced: true })
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.replay()
    h.animator.prev() // empty box, paused
    h.animator.next()
    expect(h.animator.time).toBe(1600)
    expect(h.pendingFrames).toBe(0)
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
  })

  it('paused between strokes, the last completed stroke is marked; playing on unmarks it', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1800) // gap after stroke 1
    expect(h.states()).toEqual(['done', 'todo', 'todo'])
    h.animator.pause()
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
    expect(h.els[0].offset).toBe(0)
    h.animator.play()
    expect(h.states()).toEqual(['done', 'todo', 'todo'])
  })

  it('the swept front runs along the median only: the start extension (lead) is not swept', () => {
    const h = setup()
    const targets = h.els.map((el) => ({ el, length: 550, lead: 100 }))
    h.animator.setData(DATA)
    h.animator.attach(targets)
    h.advance(600 + 16)
    // Dash end near the path start: the round cap reaches the first point of the median.
    expect(h.els[0].offset).toBeCloseTo(550 - 450 * (16 / 1000), 0)
    h.advance(484) // half the time of the stroke
    expect(h.els[0].offset).toBeCloseTo(550 - 450 * 0.5, 0)
    h.advance(496) // last frame of the stroke: the dash end has swept the length of the median
    expect(h.els[0].offset).toBeCloseTo(100 + 450 * (4 / 1000), 0)
    h.advance(16)
    expect(h.states()[0]).toBe('done')
    expect(h.els[0].offset).toBe(0)
  })

  it('fades the whole character out at the end of the hold, then starts from the empty box', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(6900 - LOOP_FADE_MS - 16)
    expect(h.states()).toEqual(['done', 'done', 'done'])
    h.advance(32)
    expect(h.states()).toEqual(['leaving', 'leaving', 'leaving'])
    expect(h.animator.getSnapshot()).toMatchObject({ stroke: 3, complete: true })
    h.advance(LOOP_FADE_MS)
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
  })

  it('pausing during the fade shows the whole character again; reduced motion does not fade', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(6900 - 100)
    h.animator.pause()
    expect(h.states()).toEqual(['done', 'done', 'done'])
    const r = setup({ reduced: true })
    r.animator.setData(DATA)
    r.animator.attach(r.targets)
    r.animator.replay()
    r.advance(6900 - 50)
    expect(r.states()).toEqual(['done', 'done', 'done'])
  })

  it('a pause carries over to the next characters (they rest on the whole character); play does too', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1000)
    h.animator.toggle() // the learner pauses
    h.animator.setData(OTHER)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: false, stroke: 1, total: 1, complete: true })
    h.animator.setData(DATA)
    h.animator.show() // observe entered again
    expect(h.animator.getSnapshot()).toMatchObject({ playing: false, stroke: 3, complete: true })
    expect(h.states()).toEqual(['done', 'done', 'done'])
    h.animator.toggle() // the learner plays: from the empty box (it was on the whole character)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: true, stroke: 0 })
    h.animator.setData(OTHER)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: true, stroke: 0 })
  })

  it('pausing to leave observe is not a choice: the next show plays', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.pause() // what the workspace does outside observe
    h.animator.show()
    expect(h.animator.getSnapshot()).toMatchObject({ playing: true, stroke: 0 })
  })

  it('reduced motion: a character rests paused on the whole character until play is pressed', () => {
    const h = setup({ reduced: true })
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: false, stroke: 3, complete: true })
    expect(h.states()).toEqual(['done', 'done', 'done'])
    expect(h.pendingFrames).toBe(0)
    h.animator.toggle()
    expect(h.animator.getSnapshot()).toMatchObject({ playing: true, stroke: 0 })
    // Asked for once, it plays for the next characters too.
    h.animator.setData(OTHER)
    expect(h.animator.getSnapshot().playing).toBe(true)
  })

  it('follows a reduced-motion change while attached, and stops listening when detached', () => {
    const h = setup()
    h.animator.setData(DATA)
    const detach = h.animator.attach(h.targets)
    expect(h.reducedWatchers).toBe(1)
    h.advance(1100)
    expect(h.els[0].offset).toBeCloseTo(250, 0)
    h.setReduced(true)
    expect(h.els[0].offset).toBe(0)
    h.setReduced(false)
    expect(h.els[0].offset).toBeCloseTo(250, 0)
    detach()
    expect(h.reducedWatchers).toBe(0)
  })

  it('a reduced-motion change during a next step finishes the step at once', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.prev()
    h.animator.next()
    h.advance(200)
    h.setReduced(true)
    expect(h.animator.time).toBe(1600)
    expect(h.pendingFrames).toBe(0)
  })

  it('prev during a stroke removes that stroke', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(2600) // stroke 2 half drawn
    expect(h.animator.getSnapshot().stroke).toBe(2)
    h.animator.prev()
    // Paused on stroke 1, which is marked as the stroke in the indicator.
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
    expect(h.els[0].offset).toBe(0)
    expect(h.animator.getSnapshot().stroke).toBe(1)
  })

  it('play from the whole character starts over instead of sitting through the hold', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    for (let i = 0; i < 3; i++) h.animator.next()
    h.advance(1100) // the last step finishes
    expect(h.animator.getSnapshot()).toMatchObject({ complete: true, playing: false })
    h.animator.play()
    expect(h.animator.time).toBe(0)
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
  })

  it('replay restarts from the empty box and plays', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.next()
    h.animator.replay()
    expect(h.animator.time).toBe(0)
    expect(h.animator.getSnapshot()).toMatchObject({ playing: true, stroke: 0 })
    expect(h.pendingFrames).toBe(1)
  })

  it('a pace change keeps the same stroke at the same progress', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1100) // stroke 1 at 50 %
    h.animator.setPace('normal')
    expect(h.animator.getSnapshot()).toMatchObject({ pace: 'normal', stroke: 1, playing: true })
    expect(h.els[0].offset).toBeCloseTo(250, 0)
    // Normal: 450 units at 1000 u/s = 450 ms; half of it is left.
    h.advance(224)
    expect(h.els[0].state).toBe('active')
    h.advance(2)
    expect(h.els[0].state).toBe('done')
  })

  it('reduced motion: no sweep — the active stroke appears whole, same cadence', () => {
    const h = setup({ reduced: true })
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.replay()
    h.advance(700)
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
    expect(h.els[0].offset).toBe(0)
    h.advance(1000)
    expect(h.states()).toEqual(['done', 'todo', 'todo'])
  })

  it('new data restarts; the same data again is a no-op', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(1000)
    const t = h.animator.time
    h.animator.setData(DATA)
    expect(h.animator.time).toBe(t)
    h.animator.setData(OTHER)
    expect(h.animator.time).toBe(0)
    expect(h.animator.getSnapshot()).toMatchObject({ total: 1, stroke: 0, playing: true })
  })

  it('does not draw onto targets of another character', () => {
    const h = setup()
    h.animator.setData(OTHER) // 1 stroke; the 3 targets belong to DATA
    h.animator.attach(h.targets)
    h.advance(1000)
    expect(h.states()).toEqual([undefined, undefined, undefined])
    h.animator.setData(DATA)
    expect(h.states()).toEqual(['todo', 'todo', 'todo'])
  })

  it('setData(null) turns it off', () => {
    const h = setup()
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.animator.setData(null)
    expect(h.animator.getSnapshot()).toMatchObject({ available: false, playing: false, total: 0, stroke: 0 })
    expect(h.pendingFrames).toBe(0)
    h.animator.replay()
    expect(h.animator.getSnapshot().playing).toBe(false)
  })

  it('attach replaces earlier targets, and a stale detach does not undo a newer attach', () => {
    const h = setup()
    h.animator.setData(DATA)
    const detachA = h.animator.attach(h.targets)
    const b = [new FakeEl(), new FakeEl(), new FakeEl()]
    h.animator.attach(b.map((el) => ({ el, length: 500 })))
    detachA() // StrictMode-style late cleanup of the first attach
    expect(h.pendingFrames).toBe(1)
    h.advance(1100)
    expect(b[0].state).toBe('active')
    // The replaced targets no longer receive writes.
    expect(h.els[0].state).toBe('todo')
  })

  it('re-attaching the same elements rewrites their state (fresh view, same position)', () => {
    const h = setup()
    h.animator.setData(DATA)
    const detach = h.animator.attach(h.targets)
    h.advance(1100)
    detach()
    for (const el of h.els) delete el.attrs['data-state']
    h.animator.attach(h.targets)
    expect(h.states()).toEqual(['active', 'todo', 'todo'])
  })

  it('a pace set before data applies to the data', () => {
    const h = setup()
    h.animator.setPace('normal')
    h.animator.setData(DATA)
    h.animator.attach(h.targets)
    h.advance(PACE.normal.leadMs + 225)
    expect(h.els[0].offset).toBeCloseTo(250, 0)
  })
})
