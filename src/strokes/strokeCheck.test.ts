import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../data/testChars'
import type { Ink, Stroke } from '../handwriting/types'
import { checkStrokes, type StrokeCheck } from './strokeCheck'
import { peekStrokeData } from './strokeData'
import { sourceToBox } from './transform'
import type { StrokeData } from './types'

type P = { x: number; y: number }

function data(c: string): StrokeData {
  const d = peekStrokeData(c)
  if (!d) throw new Error(`no stroke data for ${c}`)
  return d
}

/** The character's medians in box units, densified like real pointer samples. */
function traced(d: StrokeData): P[][] {
  return d.medians.map((m) => {
    const pts = m.map(([x, y]) => sourceToBox(x, y))
    const out: P[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.01))
      for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
    }
    return out
  })
}

function ink(strokes: P[][]): Ink {
  return {
    strokes: strokes.map((pts): Stroke => ({ pointerType: 'touch', points: pts.map((p, i) => ({ ...p, t: i * 8, p: 0.5 })) })),
  }
}

const verdicts = (c: StrokeCheck) => c.user.map((u) => u.verdict)
const allGood = (n: number) => Array.from({ length: n }, () => 'good')

describe('checkStrokes', () => {
  for (const { char } of TEST_CHARS) {
    describe(char, () => {
      const d = data(char)
      const med = traced(d)
      const n = med.length

      it('marks a faithful attempt right, stroke by stroke, in both modes', () => {
        const wobbly = med.map((s) => s.map((p, i) => ({ x: 0.5 + (p.x - 0.5) * 0.95 + 0.008 * Math.sin(i), y: 0.5 + (p.y - 0.5) * 0.95 + 0.008 * Math.cos(i) })))
        for (const mode of ['trace', 'recall'] as const) {
          expect(verdicts(checkStrokes(ink(med), d, mode))).toEqual(allGood(n))
          expect(verdicts(checkStrokes(ink(wobbly), d, mode))).toEqual(allGood(n))
        }
      })

      it('recall forgives a character written smaller and off-center; trace does not', () => {
        const small = med.map((s) => s.map((p) => ({ x: 0.3 + (p.x - 0.5) * 0.6, y: 0.35 + (p.y - 0.5) * 0.6 })))
        expect(verdicts(checkStrokes(ink(small), d, 'recall'))).toEqual(allGood(n))
        expect(verdicts(checkStrokes(ink(small), d, 'trace'))).not.toContain('good')
      })

      it('recall places the reference back onto the learner’s character', () => {
        const small = (p: P) => ({ x: 0.3 + (p.x - 0.5) * 0.6, y: 0.35 + (p.y - 0.5) * 0.6 })
        const shift = checkStrokes(ink(med.map((s) => s.map(small))), d, 'recall').referenceToInk
        expect(shift).not.toBeNull()
        for (const s of med) {
          const p = s[0]
          const want = small(p)
          expect(p.x * shift!.scale + shift!.x).toBeCloseTo(want.x, 2)
          expect(p.y * shift!.scale + shift!.y).toBeCloseTo(want.y, 2)
        }
        expect(checkStrokes(ink(med), d, 'trace').referenceToInk).toBeNull()
      })

      it('flags a reversed stroke', () => {
        const reversed = med.map((s, i) => (i === 1 ? [...s].reverse() : s))
        const check = checkStrokes(ink(reversed), d, 'recall')
        expect(check.user[1]).toMatchObject({ verdict: 'wrong', issue: 'reversed' })
        expect(verdicts(check).filter((v) => v !== 'good')).toHaveLength(1)
      })

      it('flags two strokes written in swapped order, naming the stroke each one is', () => {
        const swapped = med.map((s, i) => (i === 1 ? med[2] : i === 2 ? med[1] : s))
        const check = checkStrokes(ink(swapped), d, 'recall')
        expect(check.user[1]).toEqual({ verdict: 'wrong', issue: 'order', looksLike: 2 })
        expect(check.user[2]).toEqual({ verdict: 'wrong', issue: 'order', looksLike: 1 })
      })

      it('lists missing strokes without upsetting the ones written', () => {
        for (const mode of ['trace', 'recall'] as const) {
          const check = checkStrokes(ink(med.slice(0, n - 2)), d, mode)
          expect(verdicts(check)).toEqual(allGood(n - 2))
          expect(check.missing).toEqual([n - 2, n - 1])
        }
      })

      it('marks an extra stroke without upsetting the others', () => {
        const extra = [...med, [{ x: 0.1, y: 0.9 }, { x: 0.3, y: 0.95 }]]
        for (const mode of ['trace', 'recall'] as const) {
          const check = checkStrokes(ink(extra), d, mode)
          expect(verdicts(check).slice(0, n)).toEqual(allGood(n))
          expect(check.user[n]).toMatchObject({ verdict: 'wrong', issue: 'extra' })
        }
      })
    })
  }

  it('calls a stroke that stops halfway short', () => {
    const d = data('永')
    const med = traced(d)
    const half = med.map((s, i) => (i === 1 ? s.slice(0, Math.round(s.length * 0.45)) : s))
    expect(checkStrokes(ink(half), d, 'recall').user[1]).toMatchObject({ verdict: 'off', issue: 'short' })
  })

  it('calls a stroke moved off its place misplaced in trace', () => {
    const d = data('永')
    const med = traced(d)
    const moved = med.map((s, i) => (i === 1 ? s.map((p) => ({ x: p.x + 0.06, y: p.y + 0.02 })) : s))
    expect(checkStrokes(ink(moved), d, 'trace').user[1]).toMatchObject({ verdict: 'off', issue: 'misplaced' })
  })

  it('marks a scribble that is no stroke of the character wrong', () => {
    const d = data('学')
    const scribble = [[{ x: 0.9, y: 0.1 }, { x: 0.95, y: 0.15 }, { x: 0.9, y: 0.2 }]]
    expect(checkStrokes(ink(scribble), d, 'trace').user[0]).toMatchObject({ verdict: 'wrong', issue: 'unmatched' })
  })

  it('reports every stroke missing for an empty attempt', () => {
    const d = data('永')
    expect(checkStrokes({ strokes: [] }, d, 'recall')).toEqual({ user: [], missing: [0, 1, 2, 3, 4], referenceToInk: null })
  })
})
