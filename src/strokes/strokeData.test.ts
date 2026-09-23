import { describe, expect, it, vi } from 'vitest'
import { TEST_CHARS } from '../data/testChars'
import { getStrokeData, hasStrokeData, parseStrokeData, peekStrokeData } from './strokeData'

describe('bundled stroke data', () => {
  it.each(TEST_CHARS.map((c) => [c.char, c.strokeCount] as const))(
    '%s ships with %i strokes, each with an outline and a median',
    async (char, strokeCount) => {
      expect(hasStrokeData(char)).toBe(true)
      const data = await getStrokeData(char)
      expect(data).not.toBeNull()
      expect(data!.strokes).toHaveLength(strokeCount)
      expect(data!.medians).toHaveLength(strokeCount)
    },
  )

  it('is there synchronously, from the first call (bundled: no loading state), as one object', async () => {
    vi.resetModules() // fresh module state, whatever other tests loaded
    const fresh = await import('./strokeData')
    const data = fresh.peekStrokeData('永')
    expect(data).not.toBeNull()
    expect(fresh.peekStrokeData('永')).toBe(data)
    await expect(fresh.getStrokeData('永')).resolves.toBe(data)
  })

  it('a character without data is null, synchronously and asynchronously', async () => {
    expect(hasStrokeData('王')).toBe(false)
    expect(peekStrokeData('王')).toBeNull()
    await expect(getStrokeData('王')).resolves.toBeNull()
    expect(hasStrokeData('')).toBe(false)
    expect(peekStrokeData('')).toBeNull()
  })
})

describe('parseStrokeData', () => {
  const valid = { strokes: ['M 0 0 L 10 0 L 10 10 Z'], medians: [[[0, 0], [10, 10]]], radStrokes: [0] }
  const withMedian = (median: unknown) => ({ ...valid, medians: [median] })

  it('accepts well-formed data', () => {
    expect(parseStrokeData(valid)).toEqual(valid)
    expect(parseStrokeData({ strokes: valid.strokes, medians: valid.medians })).toEqual({
      strokes: valid.strokes,
      medians: valid.medians,
      radStrokes: undefined,
    })
  })

  it.each([
    ['null', null],
    ['a string', 'M 0 0 L 1 1 Z'],
    ['a number', 42],
    ['an array', []],
    ['missing medians', { strokes: valid.strokes }],
    ['no strokes', { strokes: [], medians: [] }],
    ['more outlines than medians', { strokes: [...valid.strokes, ...valid.strokes], medians: valid.medians }],
    ['an empty outline', { ...valid, strokes: [''] }],
    ['a non-string outline', { ...valid, strokes: [7] }],
    ['a median that is not an array', withMedian('0 0 10 10')],
    ['a single-point median', withMedian([[0, 0]])],
    ['a NaN coordinate', withMedian([[0, 0], [NaN, 1]])],
    ['an infinite coordinate', withMedian([[0, 0], [1, Infinity]])],
    ['a string coordinate', withMedian([[0, 0], ['1', 1]])],
    ['a point with one coordinate', withMedian([[0, 0], [1]])],
  ])('rejects %s', (_label, json) => {
    expect(parseStrokeData(json)).toBeNull()
  })

  it('drops malformed radStrokes but keeps the strokes', () => {
    const data = parseStrokeData({ ...valid, radStrokes: ['0'] })
    expect(data).not.toBeNull()
    expect(data!.radStrokes).toBeUndefined()
  })
})
