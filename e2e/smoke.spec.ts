import { expect, readScore, test, traceCharacter } from './fixtures'

// The workspace opens on the first practice character, 永 (5 strokes).
const FIRST = '永'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('loads on Xem with the first character', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Xem' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible()
})

test('Xem: the stroke counter advances on its own', async ({ page }) => {
  const counter = page.getByText(/^Nét \d+\/\d+$/)
  const shown = async () => Number(/(\d+)\//.exec(await counter.innerText())?.[1])
  await expect(counter).toBeVisible()
  const first = await shown()
  await expect.poll(shown, { timeout: 10_000 }).toBeGreaterThan(first)
})

test('Tô theo: tracing the reference scores well, every stroke right', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  expect(await readScore(page)).toBeGreaterThanOrEqual(80)
  // Exact: the live region's sentence contains the same words.
  await expect(page.getByText('5/5 nét đúng', { exact: true })).toBeVisible()
})

test('Nhớ lại: write, score, rate, go to the next character', async ({ page }) => {
  await page.getByRole('tab', { name: 'Nhớ lại' }).click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await page.getByRole('button', { name: 'Đúng', exact: true }).click()
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible()
})
