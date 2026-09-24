import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../test/fixtures/testChars'
import type { Ink, Stroke } from '../handwriting/types'
import { summarizeStrokes } from '../workspace/strokeFeedback'
import { checkStrokes, type StrokeCheck } from './strokeCheck'
import { fixtureStrokeData as peekStrokeData } from '../test/fixtures/strokes'
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
  return d.medians.map((m) => densify(m.map(([x, y]) => sourceToBox(x, y))))
}

function densify(pts: P[], step = 0.01): P[] {
  const out: P[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

/** Pointer-like strokes: one sample every 8 ms. */
function ink(strokes: P[][]): Ink {
  return {
    strokes: strokes.map((pts): Stroke => ({ pointerType: 'touch', points: pts.map((p, i) => ({ ...p, t: i * 8, p: 0.5 })) })),
  }
}

/** Arc length of a polyline. */
function lengthOf(pts: readonly P[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** The part of a polyline between two shares of its length. */
function portion(pts: P[], from: number, to: number): P[] {
  const total = lengthOf(pts)
  const out: P[] = []
  let walked = 0
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) walked += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (walked >= from * total && walked <= to * total) out.push(pts[i])
  }
  return out
}

/** Deterministic PRNG (mulberry32) and a normal deviate from it. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

/**
 * Handwriting-like sloppiness, stroke by stroke: moved (σ 0.012 box per axis), resized (σ 6%),
 * up to 8% left off each end, and 0.002 box of jitter per sample.
 */
function sloppy(strokes: P[][], r: () => number): P[][] {
  return strokes.map((s) => {
    const cx = s.reduce((a, p) => a + p.x, 0) / s.length
    const cy = s.reduce((a, p) => a + p.y, 0) / s.length
    const [dx, dy, scale] = [gauss(r) * 0.012, gauss(r) * 0.012, 1 + gauss(r) * 0.06]
    const from = Math.floor(s.length * r() * 0.08)
    const to = Math.max(from + 2, s.length - Math.floor(s.length * r() * 0.08))
    return s.slice(from, to).map((p) => ({
      x: cx + (p.x - cx) * scale + dx + gauss(r) * 0.002,
      y: cy + (p.y - cy) * scale + dy + gauss(r) * 0.002,
    }))
  })
}

/** Scaled by `s` about the box centre, then centred on (x, y): a character written smaller, elsewhere. */
const place = (strokes: P[][], s: number, x: number, y: number) =>
  strokes.map((st) => st.map((p) => ({ x: x + (p.x - 0.5) * s, y: y + (p.y - 0.5) * s })))

/** Nine centres — the corners, sides and middle of the range — at which `strokes` at size `s` stay inside the box (3% margin). */
function positions(strokes: P[][], s: number): [number, number][] {
  const pts = strokes.flat()
  const [minX, maxX] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))]
  const lo = (min: number) => 0.03 - (min - 0.5) * s
  const hi = (max: number) => 0.97 - (max - 0.5) * s
  const xs = [lo(minX), (lo(minX) + hi(maxX)) / 2, hi(maxX)]
  const ys = [lo(minY), (lo(minY) + hi(maxY)) / 2, hi(maxY)]
  return xs.flatMap((x) => ys.map((y): [number, number] => [x, y]))
}

const refVerdicts = (c: StrokeCheck) => c.reference.map((r) => r.verdict)
const userVerdicts = (c: StrokeCheck) => c.user.map((u) => u.verdict)
const allGood = (n: number) => Array.from({ length: n }, () => 'good')
/** Reference strokes (indices) that are not good. */
const notGood = (c: StrokeCheck) => c.reference.flatMap((r, i) => (r.verdict === 'good' ? [] : [i]))
const MODES = ['trace', 'recall'] as const

describe('checkStrokes', () => {
  for (const { char } of TEST_CHARS) {
    describe(char, () => {
      const d = data(char)
      const med = traced(d)
      const n = med.length

      it('marks a faithful attempt right, stroke by stroke, in both modes', () => {
        const wobbly = med.map((s) =>
          s.map((p, i) => ({ x: 0.5 + (p.x - 0.5) * 0.95 + 0.008 * Math.sin(i), y: 0.5 + (p.y - 0.5) * 0.95 + 0.008 * Math.cos(i) })),
        )
        for (const mode of MODES) {
          for (const attempt of [med, wobbly]) {
            const check = checkStrokes(ink(attempt), d, mode)
            expect(refVerdicts(check)).toEqual(allGood(n))
            expect(userVerdicts(check)).toEqual(allGood(n))
            expect(check.user.map((u) => u.ref)).toEqual(med.map((_, i) => i))
            expect(check.missing).toEqual([])
          }
        }
      })

      it('recall forgives a character written smaller and off-center; trace does not', () => {
        const small = med.map((s) => s.map((p) => ({ x: 0.3 + (p.x - 0.5) * 0.6, y: 0.35 + (p.y - 0.5) * 0.6 })))
        expect(refVerdicts(checkStrokes(ink(small), d, 'recall'))).toEqual(allGood(n))
        expect(refVerdicts(checkStrokes(ink(small), d, 'trace'))).not.toContain('good')
      })

      it('recall places the reference back onto the learner’s character', () => {
        const small = (p: P) => ({ x: 0.3 + (p.x - 0.5) * 0.65, y: 0.35 + (p.y - 0.5) * 0.65 })
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

      it('flags a reversed stroke, and only that one', () => {
        const reversed = med.map((s, i) => (i === 1 ? [...s].reverse() : s))
        for (const mode of MODES) {
          const check = checkStrokes(ink(reversed), d, mode)
          expect(check.reference[1]).toEqual({ verdict: 'wrong', issue: 'reversed', user: [1] })
          expect(check.user[1]).toEqual({ verdict: 'wrong', issue: 'reversed', ref: 1 })
          expect(notGood(check)).toEqual([1])
        }
      })

      it('flags two strokes written in swapped order, naming the stroke each one is', () => {
        const swapped = med.map((s, i) => (i === 1 ? med[2] : i === 2 ? med[1] : s))
        for (const mode of MODES) {
          const check = checkStrokes(ink(swapped), d, mode)
          expect(check.reference[1]).toEqual({ verdict: 'wrong', issue: 'order', user: [2] })
          expect(check.reference[2]).toEqual({ verdict: 'wrong', issue: 'order', user: [1] })
          expect(check.user[1]).toEqual({ verdict: 'wrong', issue: 'order', ref: 2 })
          expect(check.user[2]).toEqual({ verdict: 'wrong', issue: 'order', ref: 1 })
          expect(notGood(check)).toEqual([1, 2])
        }
      })

      it('flags one stroke written last as out of order, not the ones it skipped', () => {
        const late = [...med.slice(1), med[0]]
        for (const mode of MODES) {
          const check = checkStrokes(ink(late), d, mode)
          expect(check.reference[0]).toEqual({ verdict: 'wrong', issue: 'order', user: [n - 1] })
          expect(notGood(check)).toEqual([0])
        }
      })

      it('lists missing strokes at the end without upsetting the ones written', () => {
        for (const mode of MODES) {
          const check = checkStrokes(ink(med.slice(0, n - 2)), d, mode)
          expect(userVerdicts(check)).toEqual(allGood(n - 2))
          expect(check.missing).toEqual([n - 2, n - 1])
          expect(refVerdicts(check)).toEqual([...allGood(n - 2), 'missing', 'missing'])
        }
      })

      it('names a forgotten middle stroke as missing, and only it', () => {
        for (let k = 0; k < n; k++) {
          const forgot = med.filter((_, i) => i !== k)
          for (const mode of MODES) {
            const check = checkStrokes(ink(forgot), d, mode)
            expect(check.missing, `stroke ${k + 1}, ${mode}`).toEqual([k])
            expect(notGood(check), `stroke ${k + 1}, ${mode}`).toEqual([k])
            expect(userVerdicts(check)).toEqual(allGood(n - 1))
          }
        }
      })

      it('marks an extra stroke without upsetting the others', () => {
        const extra = [...med, [{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.92 }, { x: 0.3, y: 0.95 }]]
        for (const mode of MODES) {
          const check = checkStrokes(ink(extra), d, mode)
          expect(refVerdicts(check)).toEqual(allGood(n))
          expect(check.user[n]).toEqual({ verdict: 'wrong', issue: 'extra', ref: null })
        }
      })

      it('ignores taps: before, between and after the strokes', () => {
        const tap = (x: number, y: number) => [{ x, y }]
        const attempt = [tap(0.95, 0.05), ...med.slice(0, 2), tap(0.5, 0.5), ...med.slice(2), tap(0.05, 0.95)]
        for (const mode of MODES) {
          const check = checkStrokes(ink(attempt), d, mode)
          expect(refVerdicts(check)).toEqual(allGood(n))
          for (const k of [0, 3, n + 2]) expect(check.user[k]).toEqual({ verdict: 'off', issue: 'tap', ref: null })
          expect(check.reference[2].user).toEqual([4])
          if (mode === 'recall') {
            // Not stretched to reach the far corners.
            expect(check.referenceToInk!.scale).toBeCloseTo(1, 2)
          }
        }
      })

      it('calls strokes written at 60% of their length, from the middle, short — dots excepted', () => {
        const cut = med.map((s) => portion(s, 0.2, 0.8))
        const check = checkStrokes(ink(cut), d, 'trace')
        med.forEach((s, i) => {
          // Dots and the shortest strokes are not held to their ends within END_FLOOR (0.03 box).
          if (lengthOf(s) >= 0.16) expect(check.reference[i], `stroke ${i + 1}`).toMatchObject({ verdict: 'off', issue: 'short' })
        })
        expect(check.missing).toEqual([])
      })
    })
  }

  it('holds up on sloppy handwriting: nothing wrong or missing, and a mistake still found', () => {
    for (const { char } of TEST_CHARS) {
      const d = data(char)
      const med = traced(d)
      const n = med.length
      for (let seed = 1; seed <= 4; seed++) {
        const r = rng(seed * 31 + char.charCodeAt(0))
        const base = sloppy(med, r)
        // Recall: also written at three quarters of the size, a little off-center.
        const s = 0.75
        const [ox, oy] = [0.45 + r() * 0.1, 0.45 + r() * 0.1]
        const small = (strokes: P[][]) => strokes.map((st) => st.map((p) => ({ x: ox + (p.x - 0.5) * s, y: oy + (p.y - 0.5) * s })))
        const k = Math.floor(r() * n)
        const j = Math.floor(r() * (n - 1))
        for (const mode of MODES) {
          const put = mode === 'recall' ? small : (x: P[][]) => x
          const label = `${char} seed ${seed} ${mode}`
          const clean = checkStrokes(ink(put(base)), d, mode)
          expect(refVerdicts(clean).filter((v) => v === 'wrong' || v === 'missing'), label).toEqual([])
          const forgot = checkStrokes(ink(put(base.filter((_, i) => i !== k))), d, mode)
          expect(forgot.missing, `${label}, forgot ${k + 1}`).toEqual([k])
          const swapped = checkStrokes(ink(put(base.map((st, i) => (i === j ? base[j + 1] : i === j + 1 ? base[j] : st)))), d, mode)
          expect([swapped.reference[j].issue, swapped.reference[j + 1].issue], `${label}, swapped ${j + 1}/${j + 2}`).toEqual(['order', 'order'])
          const reversed = checkStrokes(ink(put(base.map((st, i) => (i === k ? [...st].reverse() : st)))), d, mode)
          expect(reversed.reference[k].issue, `${label}, reversed ${k + 1}`).toBe('reversed')
        }
      }
    }
  })

  it('謝: a forgotten stroke 11 is the only issue, in both modes', () => {
    const d = data('謝')
    const med = traced(d)
    for (const mode of MODES) {
      const check = checkStrokes(ink(med.filter((_, i) => i !== 10)), d, mode)
      expect(check.missing).toEqual([10])
      expect(notGood(check)).toEqual([10])
      expect(summarizeStrokes(check).issues).toEqual(['Nét 11: thiếu'])
    }
  })

  it('学: a forgotten first stroke is the only issue, in both modes', () => {
    const d = data('学')
    const med = traced(d)
    for (const mode of MODES) {
      const check = checkStrokes(ink(med.slice(1)), d, mode)
      expect(check.missing).toEqual([0])
      expect(userVerdicts(check)).toEqual(allGood(7))
      expect(summarizeStrokes(check).issues).toEqual(['Nét 1: thiếu'])
    }
  })

  it('永: 横折钩 written in two pieces is one split stroke; the strokes after it keep their numbers', () => {
    const d = data('永')
    const med = traced(d)
    const corner = sourceToBox(...(d.medians[1][4] as [number, number]))
    const at = med[1].reduce((best, p, i) => (Math.hypot(p.x - corner.x, p.y - corner.y) < Math.hypot(med[1][best].x - corner.x, med[1][best].y - corner.y) ? i : best), 0)
    const pieces = [med[0], med[1].slice(0, at + 1), med[1].slice(at), ...med.slice(2)]
    for (const mode of MODES) {
      const check = checkStrokes(ink(pieces), d, mode)
      expect(check.reference[1]).toEqual({ verdict: 'off', issue: 'split', user: [1, 2] })
      expect(check.user[1]).toEqual({ verdict: 'off', issue: 'split', ref: 1 })
      expect(check.user[2]).toEqual({ verdict: 'off', issue: 'split', ref: 1 })
      expect(notGood(check)).toEqual([1])
      expect(check.user[5]).toEqual({ verdict: 'good', issue: null, ref: 4 })
      expect(summarizeStrokes(check).issues).toEqual(['Nét 2: viết thành 2 nét'])
    }
  })

  it('claims a join only when it is plain: not a stroke next to a forgotten short one', () => {
    const d = data('謝')
    const med = traced(d)
    // Strokes 11 and 12 are short and parallel: 11 written a little low, 12 forgotten.
    const low = med.map((s, i) => (i === 10 ? s.map((p) => ({ x: p.x, y: p.y + 0.03 })) : s)).filter((_, i) => i !== 11)
    for (const mode of MODES) {
      const check = checkStrokes(ink(low), d, mode)
      expect(check.reference.some((r) => r.issue === 'merged'), mode).toBe(false)
      expect(check.missing, mode).toEqual([11])
    }
  })

  it('永: the same stroke written twice is one good stroke and an extra, not a split', () => {
    const d = data('永')
    const med = traced(d)
    const check = checkStrokes(ink([med[0], med[1], med[1], ...med.slice(2)]), d, 'trace')
    expect(refVerdicts(check)).toEqual(allGood(5))
    expect(check.user.filter((u) => u.issue === 'extra')).toHaveLength(1)
  })

  it('永: 撇 and 捺 joined in one stroke are one merged stroke', () => {
    const d = data('永')
    const med = traced(d)
    const check = checkStrokes(ink([...med.slice(0, 3), [...med[3], ...med[4]]]), d, 'trace')
    expect(check.reference[3]).toEqual({ verdict: 'off', issue: 'merged', user: [3] })
    expect(check.reference[4]).toEqual({ verdict: 'off', issue: 'merged', user: [3] })
    expect(check.user[3]).toEqual({ verdict: 'off', issue: 'merged', ref: 3 })
    expect(summarizeStrokes(check).issues).toEqual(['Nét 4–5: viết liền thành 1 nét'])
  })

  it('言 in 謝: stroke 3 moved toward its parallel neighbour is misplaced, not out of order', () => {
    const d = data('謝')
    const med = traced(d)
    // Strokes 3 and 4 are 0.083 box apart: moved 0.05 down, stroke 3 is nearer stroke 4's place.
    const moved = med.map((s, i) => (i === 2 ? s.map((p) => ({ x: p.x, y: p.y + 0.05 })) : s))
    for (const mode of MODES) {
      const check = checkStrokes(ink(moved), d, mode)
      expect(check.reference[2], mode).toEqual({ verdict: 'off', issue: 'misplaced', user: [2] })
      expect(notGood(check), mode).toEqual([2])
    }
  })

  it('言 in 謝: parallel strokes 3 and 4 swapped are out of order', () => {
    const d = data('謝')
    const med = traced(d)
    const swapped = med.map((s, i) => (i === 2 ? med[3] : i === 3 ? med[2] : s))
    for (const mode of MODES) {
      const check = checkStrokes(ink(swapped), d, mode)
      expect(notGood(check)).toEqual([2, 3])
      expect(check.reference[2].issue).toBe('order')
      expect(check.reference[3].issue).toBe('order')
    }
  })

  it('calls a stroke that stops halfway short', () => {
    const d = data('永')
    const med = traced(d)
    const half = med.map((s, i) => (i === 1 ? s.slice(0, Math.round(s.length * 0.45)) : s))
    for (const mode of MODES) {
      const check = checkStrokes(ink(half), d, mode)
      expect(check.reference[1]).toMatchObject({ verdict: 'off', issue: 'short' })
      expect(notGood(check)).toEqual([1])
    }
  })

  it('does not call a whole stroke a little ahead of its place short', () => {
    const d = data('永')
    const med = traced(d)
    // Stroke 4 (撇) slid 0.02 box along its own direction.
    const [a, b] = [med[3][0], med[3][med[3].length - 1]]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const slid = med.map((s, i) => (i === 3 ? s.map((p) => ({ x: p.x + ((b.x - a.x) / len) * 0.02, y: p.y + ((b.y - a.y) / len) * 0.02 })) : s))
    expect(refVerdicts(checkStrokes(ink(slid), d, 'trace'))).toEqual(allGood(5))
  })

  it('calls a stroke moved off its place misplaced in trace', () => {
    const d = data('永')
    const med = traced(d)
    const moved = med.map((s, i) => (i === 1 ? s.map((p) => ({ x: p.x + 0.06, y: p.y + 0.02 })) : s))
    const check = checkStrokes(ink(moved), d, 'trace')
    expect(check.reference[1]).toMatchObject({ verdict: 'off', issue: 'misplaced' })
    expect(notGood(check)).toEqual([1])
  })

  it('calls a scribble where a stroke belongs unmatched, and one far from every stroke extra', () => {
    const d = data('永')
    const med = traced(d)
    // Where stroke 3 (横撇) belongs, near it on average, but not along it.
    const zigzag = densify([
      { x: 0.2, y: 0.45 },
      { x: 0.25, y: 0.6 },
      { x: 0.3, y: 0.45 },
      { x: 0.35, y: 0.6 },
    ])
    const loop = densify(Array.from({ length: 13 }, (_, i) => ({ x: 0.27 + 0.06 * Math.cos((i / 6) * Math.PI), y: 0.6 + 0.06 * Math.sin((i / 6) * Math.PI) })))
    const across = densify([{ x: 0.19, y: 0.5 }, { x: 0.36, y: 0.72 }])
    for (const scribble of [zigzag, loop, across]) {
      for (const mode of MODES) {
        const check = checkStrokes(ink([med[0], med[1], scribble, med[3], med[4]]), d, mode)
        expect(check.reference[2], mode).toEqual({ verdict: 'wrong', issue: 'unmatched', user: [2] })
        expect(notGood(check)).toEqual([2])
      }
    }

    const scribble = [[{ x: 0.9, y: 0.1 }, { x: 0.95, y: 0.15 }, { x: 0.9, y: 0.2 }]]
    const far = checkStrokes(ink(scribble), data('学'), 'trace')
    expect(far.user[0]).toEqual({ verdict: 'wrong', issue: 'extra', ref: null })
    expect(far.missing).toHaveLength(8)
  })

  it('recall with one or two strokes judges them in place instead of blowing them up', () => {
    const d = data('謝')
    const med = traced(d)
    for (const attempt of [[med[0]], med.slice(0, 2)]) {
      const check = checkStrokes(ink(attempt), d, 'recall')
      expect(check.referenceToInk).toBeNull()
      expect(check.reference.slice(0, attempt.length).map((r) => r.verdict)).toEqual(allGood(attempt.length))
      expect(check.missing).toHaveLength(17 - attempt.length)
    }
    // One long stroke, small, in a corner: nothing stretches it (or the reference) across the box.
    const yong = data('永')
    const corner = traced(yong)[1].map((p) => ({ x: 0.05 + p.x * 0.3, y: 0.05 + p.y * 0.3 }))
    const check = checkStrokes(ink([corner]), yong, 'recall')
    expect(check.referenceToInk).toBeNull()
    expect(check.missing.length + notGood(check).length).toBeGreaterThanOrEqual(5)
  })

  it('recall aligns on the strokes that are right when one that set the size is missing', () => {
    const d = data('永')
    const med = traced(d)
    // Without stroke 3 (the leftmost) the attempt's box is narrower than the reference's.
    const check = checkStrokes(ink(med.filter((_, i) => i !== 2)), d, 'recall')
    expect(check.missing).toEqual([2])
    expect(notGood(check)).toEqual([2])
    expect(check.referenceToInk!.scale).toBeCloseTo(1, 2)
    expect(check.referenceToInk!.x).toBeCloseTo(0, 2)
  })

  describe('recall: a character written only in part, smaller and anywhere in the box (SC-1)', () => {
    for (const { char } of TEST_CHARS) {
      it(char, () => {
        const d = data(char)
        const med = traced(d)
        const n = med.length
        for (let k = Math.ceil(n / 2); k < n; k++) {
          for (const s of [0.6, 0.75, 0.9]) {
            for (const [x, y] of positions(med, s)) {
              const label = `${char}: first ${k} of ${n} at ${s} centred (${x.toFixed(2)}, ${y.toFixed(2)})`
              const check = checkStrokes(ink(place(med.slice(0, k), s, x, y)), d, 'recall')
              expect(refVerdicts(check), label).toEqual([...allGood(k), ...Array.from({ length: n - k }, () => 'missing')])
              // The reference is drawn onto the learner's character at its size, not blown up out of the box.
              expect(check.referenceToInk!.scale, label).toBeCloseTo(s, 1)
            }
          }
        }
      })
    }

    it('the reported cases', () => {
      const xue = data('学')
      const partial = checkStrokes(ink(place(traced(xue).slice(0, 4), 0.75, 0.56, 0.51)), xue, 'recall')
      expect(summarizeStrokes(partial).issues).toEqual(['Nét 5–8: thiếu'])
      expect(partial.referenceToInk!.scale).toBeCloseTo(0.75, 2)
      const xie = data('謝')
      expect(summarizeStrokes(checkStrokes(ink(place(traced(xie).slice(0, 13), 0.75, 0.59, 0.59)), xie, 'recall')).issues).toEqual([
        'Nét 14–17: thiếu',
      ])
      const yong = data('永')
      const without23 = traced(yong).filter((_, i) => i !== 1 && i !== 2)
      expect(summarizeStrokes(checkStrokes(ink(place(without23, 0.75, 0.44, 0.54)), yong, 'recall')).issues).toEqual(['Nét 2–3: thiếu'])
    })
  })

  it('recall: two forgotten strokes, the character smaller and anywhere, name just those two (SC-1)', () => {
    const r = rng(2024)
    for (const { char } of TEST_CHARS) {
      const d = data(char)
      const med = traced(d)
      const n = med.length
      for (let trial = 0; trial < 24; trial++) {
        const a = Math.floor(r() * n)
        const b = (a + 1 + Math.floor(r() * (n - 1))) % n
        const s = 0.6 + r() * 0.4
        const [x, y] = positions(med, s)[Math.floor(r() * 9)]
        const check = checkStrokes(ink(place(med.filter((_, i) => i !== a && i !== b), s, x, y)), d, 'recall')
        expect(check.missing, `${char} without ${a + 1} and ${b + 1} at ${s.toFixed(2)}`).toEqual([a, b].sort((p, q) => p - q))
        expect(notGood(check)).toEqual(check.missing)
      }
    }
  })

  it('recall: a few strokes (three up to half the character) written smaller are aligned too', () => {
    const d = data('謝')
    const med = traced(d)
    // 言, the first 7 strokes of 17, at 80%: not "hơi ngắn" for being judged in place.
    for (const k of [3, 5, 7, 8]) {
      const check = checkStrokes(ink(place(med.slice(0, k), 0.8, 0.52, 0.49)), d, 'recall')
      expect(refVerdicts(check).slice(0, k), `first ${k}`).toEqual(allGood(k))
      expect(check.missing).toHaveLength(17 - k)
    }
  })

  it('names strokes written out of order as such, also two swaps and a stroke moved two places (SC-2)', () => {
    for (const { char } of TEST_CHARS) {
      const d = data(char)
      const med = traced(d)
      const n = med.length
      const orders: number[][] = []
      for (let a = 0; a < n - 1; a++) {
        for (let c = a + 2; c < n - 1; c++) {
          const order = [...Array(n).keys()]
          ;[order[a], order[a + 1], order[c], order[c + 1]] = [order[a + 1], order[a], order[c + 1], order[c]]
          orders.push(order)
        }
        if (a + 2 < n) {
          const order = [...Array(n).keys()]
          ;[order[a], order[a + 2]] = [order[a + 2], order[a]]
          orders.push(order)
        }
      }
      for (const order of orders) {
        for (const mode of MODES) {
          const check = checkStrokes(ink(order.map((i) => med[i])), d, mode)
          const label = `${char} ${order.map((i) => i + 1).join(',')} ${mode}`
          expect(check.missing, label).toEqual([])
          expect(check.reference.filter((r) => r.issue === 'unmatched'), label).toEqual([])
          expect(check.user.filter((u) => u.issue === 'extra'), label).toEqual([])
          // Every stroke written where it belongs in the order is right.
          order.forEach((i, at) => {
            if (i === at) expect(check.reference[i].verdict === 'good' || check.reference[i].issue === 'order', label).toBe(true)
          })
        }
      }
    }
    const xue = data('学')
    const med = traced(xue)
    for (const mode of MODES) {
      const check = checkStrokes(ink([0, 2, 1, 4, 3, 5, 6, 7].map((i) => med[i])), xue, mode)
      expect(summarizeStrokes(check).issues, mode).toEqual(['Nét 2: sai thứ tự', 'Nét 3: sai thứ tự', 'Nét 4: sai thứ tự', 'Nét 5: sai thứ tự'])
    }
  })

  it('does not call a stroke with a tail or hook added good (SC-4)', () => {
    const tail = (s: P[], len: number, turn: number) => {
      const [a, b] = [s[s.length - 4], s[s.length - 1]]
      const angle = Math.atan2(b.y - a.y, b.x - a.x) + turn
      return [...s, ...densify([b, { x: b.x + Math.cos(angle) * len, y: b.y + Math.sin(angle) * len }]).slice(1)]
    }
    for (const [char, k, len] of [['永', 1, 0.22], ['國', 0, 0.2], ['謝', 9, 0.2], ['你', 1, 0.1]] as const) {
      const d = data(char)
      const med = traced(d)
      for (const turn of [Math.PI / 2, -Math.PI / 2, (-3 * Math.PI) / 4]) {
        const check = checkStrokes(ink(med.map((s, i) => (i === k ? tail(s, len, turn) : s))), d, 'trace')
        expect(check.reference[k].verdict, `${char} ${k + 1} + ${len}`).toBe('off')
        expect(notGood(check)).toEqual([k])
      }
    }
    // A short flick at the end is still the stroke.
    const d = data('你')
    const med = traced(d)
    expect(refVerdicts(checkStrokes(ink(med.map((s, i) => (i === 1 ? tail(s, 0.03, -Math.PI * 0.75) : s))), d, 'trace'))).toEqual(allGood(7))
  })

  it('judges a dot by a mark over its middle, not by the END_FLOOR gaps (SC-7)', () => {
    const d = data('謝')
    const med = traced(d)
    const dot = densify(med[10], 0.002) // stroke 11, 0.067 box
    for (const mode of MODES) {
      for (const half of [portion(dot, 0, 0.5), portion(dot, 0.25, 0.75), portion(dot, 0.5, 1)]) {
        expect(checkStrokes(ink(med.map((s, i) => (i === 10 ? half : s))), d, mode).reference[10].verdict, mode).toBe('good')
      }
    }
    // A 2 px speck over its middle is not the stroke; nor is a vertical mark across it reversed.
    const m = dot[Math.floor(dot.length / 2)]
    const speck = [m, { x: m.x + 0.007, y: m.y }]
    expect(checkStrokes(ink(med.map((s, i) => (i === 10 ? speck : s))), d, 'trace').reference[10]).toMatchObject({ verdict: 'off', issue: 'short' })
    const across = densify([{ x: m.x, y: m.y - 0.015 }, { x: m.x, y: m.y + 0.015 }])
    expect(checkStrokes(ink(med.map((s, i) => (i === 10 ? across : s))), d, 'trace').reference[10].issue).not.toBe('reversed')
  })

  it('calls a stroke moved sideways misplaced, not short or long, on bent and short strokes', () => {
    const shift = (s: P[], dx: number, dy: number) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    const xie = data('謝')
    const guo = data('國')
    for (const mode of MODES) {
      for (const k of [10, 11]) {
        const check = checkStrokes(ink(traced(xie).map((s, i) => (i === k ? shift(s, 0, 0.05) : s))), xie, mode)
        expect(check.reference[k], `謝 ${k + 1} ${mode}`).toMatchObject({ verdict: 'off', issue: 'misplaced' })
      }
      const check = checkStrokes(ink(traced(guo).map((s, i) => (i === 4 ? shift(s, 0.05, 0) : s))), guo, mode)
      expect(check.reference[4], `國 5 ${mode}`).toMatchObject({ verdict: 'off', issue: 'misplaced' })
    }
  })

  it('reports every stroke missing for an empty attempt', () => {
    const d = data('永')
    const missing = { verdict: 'missing', issue: null, user: [] }
    expect(checkStrokes({ strokes: [] }, d, 'recall')).toEqual({
      user: [],
      reference: [missing, missing, missing, missing, missing],
      missing: [0, 1, 2, 3, 4],
      referenceToInk: null,
    })
  })
})
