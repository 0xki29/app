import { describe, expect, it } from 'vitest'
import { normalizePoint } from './coords'

const box = { left: 20, top: 100, width: 300, height: 300 }

describe('normalizePoint', () => {
  it('maps box corners and center to [0,1]', () => {
    expect(normalizePoint(20, 100, 0, 0.5, box)).toMatchObject({ x: 0, y: 0 })
    expect(normalizePoint(320, 400, 0, 0.5, box)).toMatchObject({ x: 1, y: 1 })
    expect(normalizePoint(170, 250, 0, 0.5, box)).toMatchObject({ x: 0.5, y: 0.5 })
  })

  it('keeps time and pressure', () => {
    expect(normalizePoint(170, 250, 12.5, 0.8, box)).toEqual({ x: 0.5, y: 0.5, t: 12.5, p: 0.8 })
  })

  it('does not clamp points outside the box', () => {
    const p = normalizePoint(0, 460, 0, 0.5, box)
    expect(p.x).toBeCloseTo(-20 / 300)
    expect(p.y).toBeCloseTo(1.2)
  })

  it('is resolution independent: same relative position → same point at any box size', () => {
    const small = normalizePoint(20 + 75, 100 + 150, 0, 0.5, box)
    const big = normalizePoint(0 + 225, 0 + 450, 0, 0.5, { left: 0, top: 0, width: 900, height: 900 })
    expect(big.x).toBeCloseTo(small.x)
    expect(big.y).toBeCloseTo(small.y)
    // Denormalizing into a resized box scales geometry proportionally.
    expect(small.x * 600).toBeCloseTo(150)
    expect(small.y * 600).toBeCloseTo(300)
  })

  it('handles a zero-size box without producing NaN', () => {
    const p = normalizePoint(10, 10, 0, 0.5, { left: 0, top: 0, width: 0, height: 0 })
    expect(p).toMatchObject({ x: 0, y: 0 })
  })

  it('handles sub-pixel (coalesced) coordinates', () => {
    const p = normalizePoint(20.75, 100.25, 0, 0.5, box)
    expect(p.x).toBeCloseTo(0.75 / 300)
    expect(p.y).toBeCloseTo(0.25 / 300)
  })
})
