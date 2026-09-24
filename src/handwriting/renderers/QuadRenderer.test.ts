import { describe, expect, it } from 'vitest'
import type { Point, Stroke } from '../types'
import { QuadRenderer } from './QuadRenderer'

/** A 2D context that records which drawing calls were made. */
function recordingContext(calls: string[]): CanvasRenderingContext2D {
  const drawing = new Set(['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'fill', 'stroke'])
  return new Proxy(
    {},
    {
      get: (_, key) => (typeof key === 'string' && drawing.has(key) ? () => calls.push(key) : undefined),
      set: () => true,
    },
  ) as CanvasRenderingContext2D
}

const style = { width: 0.035, color: '#000', thinning: 0.5, streamline: 0.3 }
const at = (x: number, y: number, t: number): Point => ({ x, y, t, p: 0.5 })

describe('QuadRenderer.drawStroke', () => {
  it('draws a press held in place — its first sample repeated at the lift — as a dot', () => {
    const calls: string[] = []
    const held: Stroke = { pointerType: 'touch', points: [at(0.5, 0.5, 0), at(0.5, 0.5, 300)] }
    new QuadRenderer().drawStroke(recordingContext(calls), held, 300, style)
    expect(calls).toEqual(['beginPath', 'arc', 'fill'])
  })

  it('draws a stroke that moves as a line', () => {
    const calls: string[] = []
    const line: Stroke = { pointerType: 'touch', points: [at(0.2, 0.5, 0), at(0.3, 0.5, 16), at(0.4, 0.5, 32)] }
    new QuadRenderer().drawStroke(recordingContext(calls), line, 300, style)
    expect(calls).toContain('stroke')
    expect(calls).not.toContain('arc')
  })
})
