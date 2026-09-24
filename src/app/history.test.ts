import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goBackTo, noteArrival } from './history'

/** A browser's session history, small enough to follow: entries of hash + state, and where we are. */
function fakeBrowser(first: string) {
  const entries: { hash: string; state: unknown }[] = [{ hash: first, state: null }]
  let at = 0
  const history = {
    get state() {
      return entries[at].state
    },
    replaceState(state: unknown) {
      entries[at].state = structuredClone(state)
    },
    back: vi.fn(() => {
      at = Math.max(0, at - 1)
    }),
  }
  const location = {
    get hash() {
      return entries[at].hash
    },
    replace: vi.fn((hash: string) => {
      entries[at] = { hash, state: null }
    }),
  }
  /** A link tapped: a new entry after this one (the ones ahead are dropped). */
  const push = (hash: string) => {
    entries.splice(at + 1, entries.length, { hash, state: null })
    at++
  }
  return { history, location, push, entries: () => entries.map((e) => e.hash), at: () => at }
}

let b: ReturnType<typeof fakeBrowser>

beforeEach(() => {
  b = fakeBrowser('#/tra-cuu?q=hoc')
  vi.stubGlobal('history', b.history)
  vi.stubGlobal('location', b.location)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('back links (M10)', () => {
  it('go back when the screen was reached from the link’s target, so Back does not reopen what was left', () => {
    noteArrival(null)
    b.push('#/tu/x')
    noteArrival('#/tra-cuu?q=hoc')
    goBackTo('#/tra-cuu?q=hoc')
    expect(b.history.back).toHaveBeenCalledTimes(1)
    expect(b.location.replace).not.toHaveBeenCalled()
    expect(b.entries()).toEqual(['#/tra-cuu?q=hoc', '#/tu/x'])
    expect(b.at()).toBe(0)
  })

  it('otherwise replace this entry with the target (a deep link, or a screen reached another way)', () => {
    noteArrival(null) // opened directly
    goBackTo('#/tra-cuu')
    expect(b.history.back).not.toHaveBeenCalled()
    expect(b.entries()).toEqual(['#/tra-cuu'])
    // The entry put in place was reached from nothing left in history.
    noteArrival('#/tra-cuu?q=hoc')
    expect(b.history.state).toMatchObject({ from: null })
  })

  it('keep what an entry noted when it is returned to with Back', () => {
    noteArrival(null)
    b.push('#/tu/x')
    noteArrival('#/tra-cuu?q=hoc')
    b.push('#/luyen/5b66')
    noteArrival('#/tu/x')
    b.history.back()
    noteArrival('#/luyen/5b66') // Back: not where this entry came from
    expect(b.history.state).toMatchObject({ from: '#/tra-cuu?q=hoc' })
  })
})
