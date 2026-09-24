import { describe, expect, it } from 'vitest'
import { TEST_CHARS } from '../test/fixtures/testChars'
import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import { distanceAt, distanceTransform } from '../handwriting/scoring/geometry'
import { rasterizeOutlines } from './rasterize'
import { fixtureStrokeData as peekStrokeData } from '../test/fixtures/strokes'
import { LABEL_RADIUS, strokeLabels } from './strokeLabels'
import { SOURCE_EM, sourceToBox } from './transform'
import type { StrokeData } from './types'

const BOX_UNITS = SOURCE_EM / REFERENCE_FONT_SCALE

function data(c: string): StrokeData {
  const d = peekStrokeData(c)
  if (!d) throw new Error(`no stroke data for ${c}`)
  return d
}

describe('strokeLabels on the bundled characters', () => {
  for (const { char } of TEST_CHARS) {
    describe(char, () => {
      const d = data(char)
      const labels = strokeLabels(d)

      it('places one badge per stroke, inside the box', () => {
        expect(labels).toHaveLength(d.strokes.length)
        for (const { x, y } of labels) {
          const b = sourceToBox(x, y)
          const r = LABEL_RADIUS / BOX_UNITS
          expect(b.x - r).toBeGreaterThanOrEqual(0)
          expect(b.y - r).toBeGreaterThanOrEqual(0)
          expect(b.x + r).toBeLessThanOrEqual(1)
          expect(b.y + r).toBeLessThanOrEqual(1)
        }
      })

      it('never lets two badges touch', () => {
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const gap = Math.hypot(labels[i].x - labels[j].x, labels[i].y - labels[j].y) - 2 * LABEL_RADIUS
            expect(gap, `badges ${i + 1} and ${j + 1}`).toBeGreaterThan(0)
          }
        }
      })

      it('puts each badge nearer its own stroke start than any other start', () => {
        labels.forEach((l, i) => {
          const own = Math.hypot(l.x - d.medians[i][0][0], l.y - d.medians[i][0][1])
          expect(own, `badge ${i + 1} distance to its start`).toBeLessThanOrEqual(LABEL_RADIUS + 160)
          d.medians.forEach((m, j) => {
            if (j === i) return
            expect(Math.hypot(l.x - m[0][0], l.y - m[0][1]), `badge ${i + 1} vs start ${j + 1}`).toBeGreaterThan(own)
          })
        })
      })

      it('keeps badge centers off the reference ink', () => {
        const n = 128
        const dt = distanceTransform(rasterizeOutlines(d, n), n)
        for (const [i, l] of labels.entries()) {
          const clearance = distanceAt(dt, n, sourceToBox(l.x, l.y)) * BOX_UNITS
          expect(clearance, `badge ${i + 1}`).toBeGreaterThan(0)
        }
      })
    })
  }

  it('is computed once per data object', () => {
    const d = data('学')
    expect(strokeLabels(d)).toBe(strokeLabels(d))
  })
})

describe('strokeLabels placement rule', () => {
  // One horizontal stroke written left to right across the middle of the em square.
  const stroke: StrokeData = {
    strokes: ['M 300 420 L 700 420 L 700 380 L 300 380 Z'],
    medians: [
      [
        [300, 400],
        [700, 400],
      ],
    ],
  }

  it('puts the badge just before where the brush lands, off the stroke', () => {
    const [label] = strokeLabels(stroke)
    // Behind the start: to the left of x = 300, level with the stroke.
    expect(label.x).toBeLessThan(300 - LABEL_RADIUS)
    expect(Math.abs(label.y - 400)).toBeLessThan(LABEL_RADIUS)
  })

  it('reverses with the writing direction', () => {
    const reversed: StrokeData = { ...stroke, medians: [[...stroke.medians[0]].reverse()] }
    const [label] = strokeLabels(reversed)
    expect(label.x).toBeGreaterThan(700 + LABEL_RADIUS)
  })
})
