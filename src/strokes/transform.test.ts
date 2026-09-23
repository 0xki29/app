import { describe, expect, it } from 'vitest'
import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import type { Vec } from '../handwriting/scoring/types'
import { SOURCE_EM, SOURCE_TO_SVG_TRANSFORM, SOURCE_TOP, SVG_BOX, SVG_VIEWBOX, sourceToBox } from './transform'

const MARGIN = (1 - REFERENCE_FONT_SCALE) / 2

function expectVec(actual: Vec, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 12)
  expect(actual.y).toBeCloseTo(y, 12)
}

/** The six numbers of an SVG `matrix(a b c d e f)` transform. */
function parseMatrix(transform: string): number[] {
  const m = /^matrix\(([^)]*)\)$/.exec(transform)
  expect(m).not.toBeNull()
  const values = m![1].trim().split(/[\s,]+/).map(Number)
  expect(values).toHaveLength(6)
  expect(values.every(Number.isFinite)).toBe(true)
  return values
}

describe('sourceToBox', () => {
  it('maps the em square onto the centered reference square, y pointing down', () => {
    const bottom = SOURCE_TOP - SOURCE_EM
    expectVec(sourceToBox(0, SOURCE_TOP), MARGIN, MARGIN)
    expectVec(sourceToBox(SOURCE_EM, SOURCE_TOP), 1 - MARGIN, MARGIN)
    expectVec(sourceToBox(0, bottom), MARGIN, 1 - MARGIN)
    expectVec(sourceToBox(SOURCE_EM, bottom), 1 - MARGIN, 1 - MARGIN)
    expectVec(sourceToBox(SOURCE_EM / 2, SOURCE_TOP - SOURCE_EM / 2), 0.5, 0.5)
  })

  it('scales the em square to REFERENCE_FONT_SCALE of the box, like the font reference', () => {
    const a = sourceToBox(0, 0)
    const b = sourceToBox(SOURCE_EM, -SOURCE_EM)
    expect(b.x - a.x).toBeCloseTo(REFERENCE_FONT_SCALE, 12)
    expect(b.y - a.y).toBeCloseTo(REFERENCE_FONT_SCALE, 12)
  })

  it('keeps the dataset’s observed extent (x 41…961, y −49…856) inside the box', () => {
    for (const [x, y] of [
      [41, -49],
      [961, 856],
    ]) {
      const p = sourceToBox(x, y)
      for (const v of [p.x, p.y]) {
        expect(v).toBeGreaterThan(MARGIN)
        expect(v).toBeLessThan(1 - MARGIN)
      }
    }
  })
})

describe('SOURCE_TO_SVG_TRANSFORM', () => {
  it('is sourceToBox in SVG units, so the on-screen glyph and the scoring raster cannot drift apart', () => {
    const [a, b, c, d, e, f] = parseMatrix(SOURCE_TO_SVG_TRANSFORM)
    for (let x = -124; x <= 1100; x += 97) {
      for (let y = -200; y <= 1024; y += 89) {
        const box = sourceToBox(x, y)
        expect(a * x + c * y + e).toBeCloseTo(box.x * SVG_BOX, 9)
        expect(b * x + d * y + f).toBeCloseTo(box.y * SVG_BOX, 9)
      }
    }
  })

  it('pairs with a viewBox that spans the whole box', () => {
    expect(SVG_VIEWBOX).toBe(`0 0 ${SVG_BOX} ${SVG_BOX}`)
  })
})
