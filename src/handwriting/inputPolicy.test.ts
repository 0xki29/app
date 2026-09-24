import { describe, expect, it } from 'vitest'
import {
  decideDown,
  dropsAtEnd,
  isPalmContact,
  isStill,
  isTap,
  isUnsettled,
  PALM_CONTACT_PX,
  PEN_GRACE_MS,
  penHasPriority,
  releasedWithoutUp,
  stillPressEnd,
  TAKEOVER_MAX_MS,
  TAKEOVER_MAX_REACH,
  TAP_MAX_MS,
  TAP_MAX_REACH,
  type DownInput,
  type StrokeProgress,
} from './inputPolicy'

const NO_PEN = -Infinity

function down(patch: Partial<DownInput> = {}): DownInput {
  return { kind: 'touch', button: 0, width: 20, height: 20, timeStamp: 10_000, ...patch }
}

function active(patch: Partial<StrokeProgress> = {}): StrokeProgress {
  return { kind: 'touch', startTs: 10_000, reach: 0, ...patch }
}

describe('isTap', () => {
  it('drops a quick contact that did not move', () => {
    expect(isTap(0, 40)).toBe(true)
    expect(isTap(TAP_MAX_REACH * 0.9, TAP_MAX_MS - 1)).toBe(true)
  })

  it('keeps a quick dot: it moves', () => {
    // The shortest strokes in the bundled data (dots of 謝) reach 0.06 box.
    expect(isTap(0.03, 60)).toBe(false)
    expect(isTap(TAP_MAX_REACH, 40)).toBe(false)
  })

  it('keeps a still press held long enough to be deliberate', () => {
    expect(isTap(0, TAP_MAX_MS)).toBe(false)
    expect(isTap(0.001, 400)).toBe(false)
  })
})

describe('dropsAtEnd', () => {
  it('drops a tap, however it ended', () => {
    for (const end of ['up', 'cancel', 'lost', 'interrupted'] as const) expect(dropsAtEnd(0, 40, end, false)).toBe('tap')
  })

  it('keeps a deliberate still press the learner lifted', () => {
    expect(dropsAtEnd(0, 300, 'up', false)).toBeNull()
  })

  it('drops a still contact the app ended, however long it was held (a thumb resting on the box)', () => {
    expect(dropsAtEnd(0, 2000, 'interrupted', false)).toBe('tap')
    expect(dropsAtEnd(TAP_MAX_REACH, 2000, 'interrupted', false)).toBeNull()
  })

  it('drops a still touch that had company as the palm, keeps one that wrote', () => {
    expect(dropsAtEnd(TAKEOVER_MAX_REACH / 2, 400, 'up', true)).toBe('palm')
    expect(dropsAtEnd(TAKEOVER_MAX_REACH, 400, 'up', true)).toBeNull()
  })
})

describe('stillPressEnd (the stroke check sees the duration the input judged, EI-1)', () => {
  it('repeats the last sample at the lift for a kept press that never moved', () => {
    expect(stillPressEnd(0, 0, 300)).toBe(300)
    expect(stillPressEnd(0.002, 40, TAP_MAX_MS)).toBe(TAP_MAX_MS)
  })

  it('adds nothing when the samples already show the stroke: it moved, or they span its time', () => {
    expect(stillPressEnd(0.05, 0, 300)).toBeNull()
    expect(stillPressEnd(0, 200, 300)).toBeNull()
    expect(stillPressEnd(0, 0, 60)).toBeNull() // a tap: dropped anyway
  })
})

describe('isPalmContact', () => {
  it('ignores devices that report no contact geometry', () => {
    expect(isPalmContact(undefined, undefined)).toBe(false)
    expect(isPalmContact(1, 1)).toBe(false)
    expect(isPalmContact(0, 0)).toBe(false)
    expect(isPalmContact(NaN, Infinity)).toBe(false)
  })

  it('accepts fingertips, including iOS-sized ones (2 × a ≈ 21–31 pt radius)', () => {
    expect(isPalmContact(24, 30)).toBe(false)
    expect(isPalmContact(42, 42)).toBe(false)
    expect(isPalmContact(63, 63)).toBe(false)
    expect(isPalmContact(PALM_CONTACT_PX, PALM_CONTACT_PX)).toBe(false)
  })

  it('rejects a palm or hand edge on either axis', () => {
    expect(isPalmContact(120, 120)).toBe(true)
    expect(isPalmContact(30, 160)).toBe(true)
    expect(isPalmContact(PALM_CONTACT_PX + 1, 10)).toBe(true)
  })
})

describe('penHasPriority', () => {
  it('holds while a pen is down, however long ago it moved', () => {
    expect(penHasPriority(true, NO_PEN, 10_000)).toBe(true)
  })

  it('holds for PEN_GRACE_MS after the last pen event, then expires', () => {
    expect(penHasPriority(false, 10_000, 10_000 + PEN_GRACE_MS - 1)).toBe(true)
    expect(penHasPriority(false, 10_000, 10_000 + PEN_GRACE_MS)).toBe(false)
    expect(penHasPriority(false, NO_PEN, 10_000)).toBe(false)
  })

  it('treats out-of-order timestamps as recent', () => {
    expect(penHasPriority(false, 10_050, 10_000)).toBe(true)
  })
})

describe('isUnsettled', () => {
  it('is a stroke that barely moved and just began', () => {
    expect(isUnsettled(active({ reach: 0.01 }), 10_100)).toBe(true)
  })

  it('ends once the stroke moves or ages', () => {
    expect(isUnsettled(active({ reach: TAKEOVER_MAX_REACH }), 10_100)).toBe(false)
    expect(isUnsettled(active(), 10_000 + TAKEOVER_MAX_MS)).toBe(false)
  })
})

describe('isStill', () => {
  it('is a touch that has not reached TAKEOVER_MAX_REACH, however old', () => {
    expect(isStill(0)).toBe(true)
    expect(isStill(TAKEOVER_MAX_REACH * 0.99)).toBe(true)
    expect(isStill(TAKEOVER_MAX_REACH)).toBe(false)
  })
})

describe('releasedWithoutUp', () => {
  it('ends a mouse or pen stroke that moves with no button pressed (lost pointerup)', () => {
    expect(releasedWithoutUp('mouse', 0, 1)).toBe(true)
    expect(releasedWithoutUp('pen', 0, 1)).toBe(true)
  })

  it('keeps pressed mouse/pen strokes and every touch stroke', () => {
    expect(releasedWithoutUp('mouse', 1, 1)).toBe(false)
    expect(releasedWithoutUp('pen', 3, 1)).toBe(false) // barrel button pressed mid-stroke
    expect(releasedWithoutUp('touch', 0, 1)).toBe(false)
  })

  it('ends the stroke when the primary button is released while another is held (EI-3)', () => {
    // Left button down, right button down, left button up: only the right one is held.
    expect(releasedWithoutUp('mouse', 2, 1)).toBe(true)
    // Pen tip lifted with the barrel button held.
    expect(releasedWithoutUp('pen', 2, 3)).toBe(true)
  })

  it('does not apply to a device that reported no button at pointerdown', () => {
    expect(releasedWithoutUp('pen', 0, 0)).toBe(false)
  })
})

describe('decideDown', () => {
  it('starts a stroke from any device on the primary button', () => {
    for (const kind of ['touch', 'pen', 'mouse'] as const) {
      expect(decideDown(down({ kind }), null, NO_PEN)).toEqual({ action: 'start' })
    }
  })

  it('ignores other buttons (right click, pen barrel or eraser)', () => {
    expect(decideDown(down({ kind: 'mouse', button: 2 }), null, NO_PEN)).toEqual({ action: 'ignore', reason: 'button' })
    expect(decideDown(down({ kind: 'pen', button: 5 }), null, NO_PEN)).toEqual({ action: 'ignore', reason: 'button' })
  })

  describe('pen priority (A9: not a permanent lock)', () => {
    it('ignores touch while a pen stroke is in progress', () => {
      const pen = active({ kind: 'pen', startTs: 0 })
      expect(decideDown(down(), pen, 0)).toEqual({ action: 'ignore', reason: 'pen' })
    })

    it('ignores touch shortly after the pen was used', () => {
      expect(decideDown(down({ timeStamp: 10_000 }), null, 9_000)).toEqual({ action: 'ignore', reason: 'pen' })
    })

    it('lets touch write again once the pen has been idle for PEN_GRACE_MS', () => {
      expect(decideDown(down({ timeStamp: 9_000 + PEN_GRACE_MS }), null, 9_000)).toEqual({ action: 'start' })
    })

    it('does not hold back the pen or the mouse', () => {
      expect(decideDown(down({ kind: 'pen' }), null, 9_900)).toEqual({ action: 'start' })
      expect(decideDown(down({ kind: 'mouse' }), null, 9_900)).toEqual({ action: 'start' })
    })

    it('a pen landing during a touch stroke replaces it (the touch was the hand)', () => {
      const touch = active({ reach: 0.3, startTs: 5_000 })
      expect(decideDown(down({ kind: 'pen' }), touch, NO_PEN)).toEqual({ action: 'replace' })
    })
  })

  describe('palm contact (A10)', () => {
    it('ignores a palm-sized touch', () => {
      expect(decideDown(down({ width: 140, height: 90 }), null, NO_PEN)).toEqual({ action: 'ignore', reason: 'palm' })
    })

    it('does not let a palm-sized touch take over', () => {
      expect(decideDown(down({ width: 140, height: 90 }), active(), NO_PEN)).toEqual({ action: 'ignore', reason: 'palm' })
    })

    it('applies to touch only (pen and mouse report tool geometry, not skin)', () => {
      expect(decideDown(down({ kind: 'pen', width: 140 }), null, NO_PEN)).toEqual({ action: 'start' })
    })
  })

  describe('touch takeover (A10, EI-2): movement decides, not arrival', () => {
    it('a new touch next to a touch that has not moved is watched: whichever moves first writes', () => {
      const palm = active({ startTs: 10_000, reach: 0.005 })
      expect(decideDown(down({ timeStamp: 10_120 }), palm, NO_PEN)).toEqual({ action: 'standby' })
    })

    it('however long the still touch has rested (a hand edge does not block the finger)', () => {
      const held = active({ startTs: 10_000, reach: 0 })
      expect(decideDown(down({ timeStamp: 10_000 + TAKEOVER_MAX_MS * 4 }), held, NO_PEN)).toEqual({ action: 'standby' })
    })

    it('a stroke that is being written keeps the box', () => {
      const writing = active({ startTs: 10_000, reach: 0.05 })
      expect(decideDown(down({ timeStamp: 10_120 }), writing, NO_PEN)).toEqual({ action: 'ignore', reason: 'busy' })
    })

    it('never replaces a mouse or pen stroke', () => {
      expect(decideDown(down({ timeStamp: 10_010 }), active({ kind: 'mouse' }), NO_PEN)).toEqual({
        action: 'ignore',
        reason: 'busy',
      })
      expect(decideDown(down({ kind: 'mouse', timeStamp: 10_010 }), active(), NO_PEN)).toEqual({
        action: 'ignore',
        reason: 'busy',
      })
    })
  })

  describe('lost pointerup (EI-3)', () => {
    it('the mouse, or a pen, down again during its own stroke ends that stroke first', () => {
      expect(decideDown(down({ kind: 'mouse' }), active({ kind: 'mouse', reach: 0.3 }), NO_PEN)).toEqual({ action: 'restart' })
      expect(decideDown(down({ kind: 'pen' }), active({ kind: 'pen', reach: 0.3 }), NO_PEN)).toEqual({ action: 'restart' })
    })

    it('another kind of pointer does not', () => {
      expect(decideDown(down({ kind: 'mouse' }), active({ kind: 'pen' }), NO_PEN)).toEqual({ action: 'ignore', reason: 'busy' })
    })
  })
})
