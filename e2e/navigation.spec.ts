import type { Page } from '@playwright/test'
import { entryUrl, expect, test } from './fixtures'

// Moving between screens: Back returns to a screen as it was left, in-app back links do not pile up
// history entries (so a phone's Back button does not reopen what was just left), and a new screen
// takes focus on its heading and names itself in the title.

async function search(page: Page, q: string) {
  await page.getByRole('searchbox').fill(q)
  await page.waitForFunction((hash) => location.hash === hash, `#/tra-cuu?q=${encodeURIComponent(q)}`)
  await expect(page.locator('.dict-results--stale')).toHaveCount(0)
  await expect(page.locator('.dict-results, .dict-empty').first()).toBeVisible({ timeout: 30_000 })
}

const historyLength = (page: Page) => page.evaluate(() => history.length)

test('Back returns to the results where they were left, the list still expanded (M9)', async ({ page }) => {
  await page.goto('./#/tra-cuu')
  await search(page, 'hoc')
  const more = page.locator('.dict-group').first().getByRole('button', { name: /^Xem thêm/ })
  await more.click()
  await expect(more).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  // The position is saved into the history entry shortly after scrolling stops.
  await expect.poll(() => page.evaluate(() => (history.state as { scroll?: number } | null)?.scroll ?? 0)).toBeGreaterThan(300)
  const y = await page.evaluate(() => window.scrollY)
  // The last result on the page, in view at the bottom: tapping it scrolls nothing.
  const hit = page.locator('.dict-hit').last()
  const word = (await hit.locator('.dict-hit__simp').innerText()).trim()
  await hit.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(word)
  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('hoc')
  await expect(page.locator('.dict-group').first().getByRole('button', { name: /^Xem thêm/ })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 10)
})

test('in-app back links go back instead of adding a history entry (M10)', async ({ page }) => {
  await page.goto('./#/tra-cuu')
  await search(page, 'xuesheng')
  await page.locator('.dict-hit').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('学生')
  const before = await historyLength(page)
  await page.getByRole('link', { name: 'Tra cứu' }).first().click()
  await expect(page.getByRole('searchbox')).toHaveValue('xuesheng')
  expect(await historyLength(page)).toBe(before)

  // Entry → Luyện viết → Quay lại: back on the entry, and the practice is not the next Back.
  await page.locator('.dict-hit').first().click()
  await page.locator('.dict-char').first().getByRole('link', { name: 'Luyện viết', exact: true }).click()
  await expect(page).toHaveURL(/#\/luyen\/5b66$/)
  await page.getByRole('button', { name: 'Quay lại' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('学生')
  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('xuesheng')
})

test('an entry opened from the keyboard takes focus on its headword and names the word in the title (M12)', async ({ page }) => {
  await page.goto('./#/tra-cuu')
  await search(page, 'xiexie')
  await page.getByRole('searchbox').press('Enter')
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toContainText('谢谢')
  await expect(h1).toBeFocused()
  await expect(page).toHaveTitle(/^谢谢 xiè xie · Tra cứu · Chinese Notebook$/)
  // Another screen by its link: focus goes to that screen's heading.
  await page.getByRole('link', { name: 'Sổ ôn tập', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sổ ôn tập' })).toBeFocused()
})

test('the trace practice of a traditional form is a full-size button (L4)', async ({ page }) => {
  await page.goto(entryUrl('學生|学生[xue2 sheng5]'))
  const trad = page.getByRole('link', { name: 'Luyện viết chữ phồn thể' })
  await expect(trad).toHaveAttribute('href', '#/luyen/5b78')
  expect((await trad.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})
