import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  frameAt,
  nextStop,
  PACE,
  polylineLength,
  prevStop,
  retime,
  strokeDurationMs,
  strokeNumber,
  wrapTime,
  type PaceConfig,
} from './timeline'

/** Round numbers: 1 unit = 1 ms, lead 100, gap 50, hold 200, strokes 100..1000 ms. */
const P: PaceConfig = { unitsPerSecond: 1000, minStrokeMs: 100, maxStrokeMs: 1000, strokeGapMs: 50, holdMs: 200, leadMs: 100 }

// Strokes of 300, 100 (clamped up from 20) and 1000 (clamped down from 5000) ms:
//   lead [0,100) s0 [100,400) gap [400,450) s1 [450,550) gap [550,600) s2 [600,1600) hold [1600,1800)
const TL = buildTimeline([300, 20, 5000], P)

describe('polylineLength', () => {
  it('sums segment lengths', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11)
  })

  it('is 0 for a single point or repeated points', () => {
    expect(polylineLength([[5, 5]])).toBe(0)
    expect(polylineLength([[5, 5], [5, 5]])).toBe(0)
  })
})

describe('strokeDurationMs', () => {
  it('is length / speed within the clamp', () => {
    expect(strokeDurationMs(450, PACE.slow)).toBeCloseTo(1000)
    expect(strokeDurationMs(500, PACE.normal)).toBeCloseTo(500)
  })

  it('clamps dots up and long strokes down', () => {
    expect(strokeDurationMs(10, PACE.slow)).toBe(PACE.slow.minStrokeMs)
    expect(strokeDurationMs(5000, PACE.slow)).toBe(PACE.slow.maxStrokeMs)
  })

  it('gives zero-length and invalid medians the minimum duration', () => {
    expect(strokeDurationMs(0, P)).toBe(P.minStrokeMs)
    expect(strokeDurationMs(Number.NaN, P)).toBe(P.minStrokeMs)
    expect(strokeDurationMs(-5, P)).toBe(P.minStrokeMs)
  })

  it('slow is slower than normal for every stroke length', () => {
    for (const length of [0, 84, 300, 700, 1354, 3000]) {
      expect(strokeDurationMs(length, PACE.slow)).toBeGreaterThan(strokeDurationMs(length, PACE.normal))
    }
  })
})

describe('buildTimeline', () => {
  it('lays out lead, strokes with gaps between them, then hold', () => {
    expect(TL.strokes).toEqual([
      { start: 100, end: 400 },
      { start: 450, end: 550 },
      { start: 600, end: 1600 },
    ])
    expect(TL.total).toBe(1800)
  })

  it('has no gap for a single stroke', () => {
    const one = buildTimeline([300], P)
    expect(one.strokes).toEqual([{ start: 100, end: 400 }])
    expect(one.total).toBe(600)
  })

  it('is lead + hold without strokes', () => {
    expect(buildTimeline([], P)).toEqual({ strokes: [], total: 300 })
  })
})

describe('wrapTime', () => {
  it('folds any time into [0, total)', () => {
    expect(wrapTime(TL, 0)).toBe(0)
    expect(wrapTime(TL, 1800)).toBe(0)
    expect(wrapTime(TL, 1900)).toBe(100)
    expect(wrapTime(TL, -100)).toBe(1700)
    expect(wrapTime(TL, 1800 * 1e9 + 250)).toBeCloseTo(250, 3)
  })

  it('maps non-finite times and empty timelines to 0', () => {
    expect(wrapTime(TL, Number.NaN)).toBe(0)
    expect(wrapTime(TL, Number.POSITIVE_INFINITY)).toBe(0)
    expect(wrapTime({ strokes: [], total: 0 }, 500)).toBe(0)
  })

  it('never returns total itself for a tiny negative time', () => {
    const w = wrapTime(TL, -1e-13)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThan(TL.total)
  })
})

describe('frameAt', () => {
  it('starts with an empty box (lead)', () => {
    expect(frameAt(TL, 0)).toEqual({ completed: 0, active: -1, progress: 0, phase: 'lead' })
    expect(frameAt(TL, 99.9).phase).toBe('lead')
  })

  it('draws a stroke over [start, end)', () => {
    expect(frameAt(TL, 100)).toEqual({ completed: 0, active: 0, progress: 0, phase: 'stroke' })
    expect(frameAt(TL, 250)).toEqual({ completed: 0, active: 0, progress: 0.5, phase: 'stroke' })
    expect(frameAt(TL, 1100)).toEqual({ completed: 2, active: 2, progress: 0.5, phase: 'stroke' })
  })

  it('counts a stroke as completed exactly at its end', () => {
    expect(frameAt(TL, 400)).toEqual({ completed: 1, active: -1, progress: 0, phase: 'gap' })
    expect(frameAt(TL, 449.99)).toEqual({ completed: 1, active: -1, progress: 0, phase: 'gap' })
    expect(frameAt(TL, 550).phase).toBe('gap')
  })

  it('holds the whole character after the last stroke, then wraps', () => {
    expect(frameAt(TL, 1600)).toEqual({ completed: 3, active: -1, progress: 0, phase: 'hold' })
    expect(frameAt(TL, 1799.9).phase).toBe('hold')
    expect(frameAt(TL, 1800).phase).toBe('lead')
    expect(frameAt(TL, 1800 + 250)).toEqual(frameAt(TL, 250))
  })

  it('handles huge and negative times', () => {
    expect(frameAt(TL, 1800 * 1e6 + 1100).active).toBe(2)
    expect(frameAt(TL, -200).phase).toBe('hold')
  })

  it('keeps progress within [0, 1) for every stroke', () => {
    for (let t = 0; t < TL.total; t += 7) {
      const f = frameAt(TL, t)
      expect(f.progress).toBeGreaterThanOrEqual(0)
      expect(f.progress).toBeLessThan(1)
      if (f.active >= 0) expect(f.completed).toBe(f.active)
    }
  })

  it('is monotonic over one loop: strokes only ever get completed, in order', () => {
    let lastCompleted = 0
    for (let t = 0; t < TL.total; t += 3) {
      const { completed } = frameAt(TL, t)
      expect(completed).toBeGreaterThanOrEqual(lastCompleted)
      lastCompleted = completed
    }
    expect(lastCompleted).toBe(3)
  })

  it('works for a single stroke', () => {
    const one = buildTimeline([300], P)
    expect(frameAt(one, 50).phase).toBe('lead')
    expect(frameAt(one, 250)).toEqual({ completed: 0, active: 0, progress: 0.5, phase: 'stroke' })
    expect(frameAt(one, 400)).toEqual({ completed: 1, active: -1, progress: 0, phase: 'hold' })
  })

  it('is an empty lead frame without strokes', () => {
    expect(frameAt(buildTimeline([], P), 150)).toEqual({ completed: 0, active: -1, progress: 0, phase: 'lead' })
  })

  it('never lets a zero-duration stroke be active', () => {
    const zero: PaceConfig = { ...P, minStrokeMs: 0, strokeGapMs: 0 }
    const tl = buildTimeline([0, 100], zero)
    // Stroke 0 is [100, 100): at 100 it is already done and stroke 1 starts.
    expect(frameAt(tl, 100)).toEqual({ completed: 1, active: 1, progress: 0, phase: 'stroke' })
  })
})

describe('strokeNumber', () => {
  it('is the active stroke, else the last completed, 1-based; 0 on an empty box', () => {
    expect(strokeNumber(frameAt(TL, 50))).toBe(0)
    expect(strokeNumber(frameAt(TL, 250))).toBe(1)
    expect(strokeNumber(frameAt(TL, 420))).toBe(1)
    expect(strokeNumber(frameAt(TL, 500))).toBe(2)
    expect(strokeNumber(frameAt(TL, 1700))).toBe(3)
  })
})

describe('nextStop', () => {
  it('finishes the stroke being drawn', () => {
    expect(nextStop(TL, 250)).toBe(400)
    expect(nextStop(TL, 100)).toBe(400)
  })

  it('draws the next stroke whole from the lead or a gap', () => {
    expect(nextStop(TL, 0)).toBe(400)
    expect(nextStop(TL, 400)).toBe(550)
    expect(nextStop(TL, 420)).toBe(550)
    expect(nextStop(TL, 550)).toBe(1600)
  })

  it('stays on the whole character instead of wrapping', () => {
    expect(nextStop(TL, 1600)).toBe(1600)
    expect(nextStop(TL, 1750)).toBe(1600)
  })

  it('increments the drawn stroke count by exactly one from any resting position', () => {
    let t = 0
    for (let k = 1; k <= 3; k++) {
      t = nextStop(TL, t)
      expect(frameAt(TL, t).completed).toBe(k)
    }
  })

  it('is 0 without strokes', () => {
    expect(nextStop(buildTimeline([], P), 50)).toBe(0)
  })
})

describe('prevStop', () => {
  it('removes the last completed stroke', () => {
    expect(prevStop(TL, 1600)).toBe(550)
    expect(prevStop(TL, 1700)).toBe(550)
    expect(prevStop(TL, 550)).toBe(400)
    expect(prevStop(TL, 420)).toBe(0)
  })

  it('removes the stroke being drawn (the one in the indicator)', () => {
    expect(prevStop(TL, 1100)).toBe(550)
    expect(prevStop(TL, 500)).toBe(400)
    expect(prevStop(TL, 250)).toBe(0)
  })

  it('stays on the empty box', () => {
    expect(prevStop(TL, 0)).toBe(0)
    expect(prevStop(TL, 50)).toBe(0)
  })

  it('always lowers the indicator by one, down to 0', () => {
    for (let t = 0; t < TL.total; t += 11) {
      const shown = strokeNumber(frameAt(TL, t))
      expect(strokeNumber(frameAt(TL, prevStop(TL, t)))).toBe(Math.max(0, shown - 1))
    }
  })

  it('undoes nextStop from a resting position', () => {
    for (const rest of [0, 400, 550]) expect(prevStop(TL, nextStop(TL, rest))).toBe(rest)
  })
})

describe('retime (pace change)', () => {
  const slow = buildTimeline([300, 20, 5000], PACE.slow)
  const normal = buildTimeline([300, 20, 5000], PACE.normal)

  it('keeps the same stroke and the same progress', () => {
    const t = slow.strokes[2].start + 0.25 * (slow.strokes[2].end - slow.strokes[2].start)
    const f = frameAt(normal, retime(slow, normal, t))
    expect(f.active).toBe(2)
    expect(f.progress).toBeCloseTo(0.25, 9)
  })

  it('keeps the phase and its fraction (lead, gap, hold)', () => {
    const lead = retime(slow, normal, slow.strokes[0].start / 2)
    expect(lead).toBeCloseTo(normal.strokes[0].start / 2, 9)
    const gapMid = (slow.strokes[0].end + slow.strokes[1].start) / 2
    expect(retime(slow, normal, gapMid)).toBeCloseTo((normal.strokes[0].end + normal.strokes[1].start) / 2, 9)
    const holdMid = (slow.strokes[2].end + slow.total) / 2
    expect(retime(slow, normal, holdMid)).toBeCloseTo((normal.strokes[2].end + normal.total) / 2, 9)
  })

  it('maps resting positions (stroke ends) exactly', () => {
    slow.strokes.forEach((s, i) => expect(retime(slow, normal, s.end)).toBe(normal.strokes[i].end))
    expect(retime(slow, normal, 0)).toBe(0)
  })

  it('round-trips', () => {
    for (let t = 0; t < slow.total; t += 97) {
      expect(retime(normal, slow, retime(slow, normal, t))).toBeCloseTo(t, 6)
    }
  })

  it('shows the same frame before and after at every instant', () => {
    for (let t = 0; t < slow.total; t += 13) {
      const a = frameAt(slow, t)
      const b = frameAt(normal, retime(slow, normal, t))
      expect([b.phase, b.completed, b.active]).toEqual([a.phase, a.completed, a.active])
      expect(b.progress).toBeCloseTo(a.progress, 9)
    }
  })

  it('restarts when the timelines describe different strokes', () => {
    expect(retime(slow, buildTimeline([300], PACE.normal), 1000)).toBe(0)
  })
})

describe('PACE', () => {
  it('keeps every loop of the test characters between a few seconds and half a minute', () => {
    // Median lengths of the bundled data span ~84..1354 units; 謝 has 17 strokes.
    const lengths = Array.from({ length: 17 }, (_, i) => 84 + (i * (1354 - 84)) / 16)
    for (const pace of [PACE.slow, PACE.normal]) {
      const total = buildTimeline(lengths, pace).total
      expect(total).toBeGreaterThan(3000)
      expect(total).toBeLessThan(40000)
    }
  })
})
