import { existsSync, readFileSync } from 'node:fs'
import { expect, test as base, type Page } from '@playwright/test'
import { sourceToBox } from '../src/strokes/transform'

/**
 * Every test also fails on a console error or an uncaught exception in the page: a smoke test that
 * passes over a crashed effect or a missing asset is no smoke test. A test that provokes a failure
 * on purpose lists the errors it expects with `test.use({ expectedErrors: [...] })`.
 */
export const test = base.extend<{ expectedErrors: RegExp[]; pageErrors: string[] }>({
  expectedErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, expectedErrors }, use) => {
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      page.on('pageerror', (err) => errors.push(err.message))
      await use(errors)
      const unexpected = errors.filter((e) => !expectedErrors.some((re) => re.test(e)))
      expect(unexpected, 'console errors and uncaught exceptions').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/**
 * A character's stroke medians (centerlines in writing direction), in dataset units: from the stroke
 * files the data build put in public/ (the very files the app fetches), else from the test fixtures
 * (the five prototype characters, same bytes).
 */
function medians(char: string): [number, number][][] {
  const hex = char.codePointAt(0)!.toString(16)
  const built = new URL(`../public/strokes/v2.0.1/${hex}.json`, import.meta.url)
  const file = existsSync(built) ? built : new URL(`../src/test/fixtures/strokes/${hex}.json`, import.meta.url)
  return (JSON.parse(readFileSync(file, 'utf8')) as { medians: [number, number][][] }).medians
}

/** Free practice of a character (all three tabs, no session): 永 → `./#/luyen/6c38`. */
export function practiceUrl(char: string): string {
  return `./#/luyen/${char.codePointAt(0)!.toString(16)}`
}

/** A dictionary entry by its key ("學生|学生[xue2 sheng5]"). */
export function entryUrl(key: string): string {
  return `./#/tu/${encodeURIComponent(key)}`
}

/**
 * Waits until the dock's buttons take taps again: after a rating or "Tiếp tục" the new primary
 * button ignores taps for 500 ms (data-guard), and so do a new result's buttons (inert).
 */
export async function dockReady(page: Page): Promise<void> {
  await expect(page.locator('.dock .btn[data-guard], .result__body[data-guard]')).toHaveCount(0)
}

export interface TraceOptions {
  /** Which strokes to write (0-based, in this order). Default: all, in stroke order. */
  strokes?: number[]
  /** Write each stroke backwards, from its end to its start. */
  reversed?: boolean
  /** Write with the mouse (default) or with a finger (touch events through the DevTools protocol). */
  input?: 'mouse' | 'touch'
}

type Pt = { x: number; y: number }

/** A stroke's median in page px. */
export async function strokePoints(page: Page, char: string, stroke: number): Promise<Pt[]> {
  const rect = await writingBox(page)
  return medians(char)[stroke].map(([x, y]) => {
    const p = sourceToBox(x, y)
    return { x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height }
  })
}

/**
 * Writes `char` along its medians, one pen-down per stroke, in stroke order. The app's own dataset
 * → box mapping places them, so the ink lands on the reference the app shows.
 */
export async function traceCharacter(page: Page, char: string, options: TraceOptions = {}): Promise<void> {
  const touch = options.input === 'touch' ? await touchscreen(page) : null
  for (const i of options.strokes ?? medians(char).keys()) {
    const median = await strokePoints(page, char, i)
    const points = options.reversed ? median.reverse() : median
    if (touch) {
      await touch.write(points)
      continue
    }
    await page.mouse.move(points[0].x, points[0].y)
    await page.mouse.down()
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 })
    await page.mouse.up()
  }
  await touch?.detach()
}

/** A touch point: `radius` CSS px (Chrome reports a contact 2 × radius wide). */
export interface Finger extends Pt {
  id: number
  radius?: number
}

/**
 * Touch input through the DevTools protocol, with several fingers at once (page.touchscreen only
 * taps). Every event lists all the fingers down; 'touchEnd' lifts them all (Chrome does not lift a
 * finger left out of a move until the next end).
 */
export async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map((f) => ({ x: f.x, y: f.y, id: f.id, radiusX: f.radius ?? 6, radiusY: f.radius ?? 6, force: 0.5 })),
    })
  return {
    send,
    /** One finger along `points`, next to `others` (already down, and still); then all are lifted. */
    async write(points: Pt[], others: Finger[] = []) {
      const finger = (p: Pt): Finger => ({ ...p, id: 1 })
      await send('touchStart', [...others, finger(points[0])])
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]]
        for (let k = 1; k <= 4; k++) await send('touchMove', [...others, finger({ x: a.x + ((b.x - a.x) * k) / 4, y: a.y + ((b.y - a.y) * k) / 4 })])
      }
      await send('touchEnd', [])
    },
    detach: () => cdp.detach(),
  }
}

/** Where the writing box is on the page, in CSS px. */
export async function writingBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  // A class, not a role: the geometry belongs to this element, and its label changes by mode.
  const rect = await page.locator('.hw-box').boundingBox()
  if (!rect) throw new Error('The writing box is not visible')
  return rect
}

/** The total of the shown result, from its accessible name ("98 điểm hình dáng, Rất tốt, 5/5 nét đúng"). */
export async function readScore(page: Page): Promise<number> {
  const result = page.getByRole('region', { name: /\d+ điểm/ })
  await expect(result).toBeVisible()
  const match = /(\d+) điểm/.exec(await result.ariaSnapshot())
  if (!match) throw new Error('No score in the result panel')
  return Number(match[1])
}
