import type { Page } from '@playwright/test'
import { expect, practiceUrl, readScore, test, traceCharacter } from './fixtures'

// The result panel on small screens (A11, F7): it never covers the writing box, its buttons show
// whole, and the page does not scroll. The viewport is set here, so one project runs these.
const FIRST = '永'

for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('the result fits beside or under the box, never over it', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'portrait', 'the viewport is set by the test')
      await page.goto(practiceUrl(FIRST))
      await page.getByRole('tab', { name: 'Tô theo' }).click()
      // Every stroke backwards: the most issue lines, and "+N lỗi khác" to open.
      await traceCharacter(page, FIRST, { reversed: true })
      await page.getByRole('button', { name: 'Chấm điểm' }).click()
      await readScore(page)
      await expectFits(page)

      await page.getByRole('button', { name: /lỗi khác/ }).click()
      await expect(page.getByRole('button', { name: 'Thu gọn' })).toBeVisible()
      await expectFits(page)
      // The prompt gives way by whole lines, never clipped through one (F7).
      const clipped = await page.locator('.prompt').evaluate((el) => el.scrollHeight - el.clientHeight)
      expect(clipped).toBeLessThanOrEqual(1)
    })
  })
}

async function expectFits(page: Page) {
  const layout = await page.evaluate(() => {
    const rect = (el: Element | null) => el!.getBoundingClientRect()
    const box = rect(document.querySelector('.hw-box'))
    const result = rect(document.querySelector('section.result'))
    const buttons = [...document.querySelectorAll('section.result .btn')].map((b) => b.getBoundingClientRect().bottom)
    const overlap = box.left < result.right && result.left < box.right && box.top < result.bottom && result.top < box.bottom
    return {
      overlap,
      lowestButton: Math.max(...buttons),
      height: window.innerHeight,
      scroll: document.documentElement.scrollHeight - window.innerHeight,
    }
  })
  expect(layout.overlap, 'the result covers the box').toBe(false)
  expect(layout.lowestButton).toBeLessThanOrEqual(layout.height)
  expect(layout.scroll).toBeLessThanOrEqual(0)
}
