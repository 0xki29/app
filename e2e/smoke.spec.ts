import { dockReady, expect, practiceUrl, readScore, test, traceCharacter } from './fixtures'

// Free practice of 永 (5 strokes): the workspace with all three tabs, outside any session.
const FIRST = '永'

test.beforeEach(async ({ page }) => {
  await page.goto(practiceUrl(FIRST))
})

test('home is Hôm nay, with the bottom navigation', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Hôm nay', level: 1 })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  await expect(nav.getByRole('link')).toHaveText(['Hôm nay', 'Tra cứu', 'Sổ ôn tập'])
  await expect(nav.getByRole('link', { name: 'Hôm nay' })).toHaveAttribute('aria-current', 'page')
})

test('loads on Xem with the character, its reading and meaning', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Xem' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab')).toHaveText(['Xem', 'Tô theo', 'Nhớ lại'])
  // From the dictionary: yǒng · vĩnh, and a Vietnamese meaning.
  await expect(page.locator('.prompt__pinyin')).toContainText('yǒng')
  await expect(page.locator('.prompt__pinyin')).toContainText('vĩnh')
  await expect(page.locator('.prompt__meaning')).not.toBeEmpty()
  await expect(page.getByRole('button', { name: 'Quay lại' })).toBeVisible()
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

test('Nhớ lại: write, score, rate; free practice starts the character over, unrecorded', async ({ page }) => {
  await page.getByRole('tab', { name: 'Nhớ lại' }).click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await page.getByRole('button', { name: 'Đúng', exact: true }).click()
  await expect(page.locator('.toast')).toHaveText(`${FIRST} → Đúng (luyện tự do, không tính lịch ôn)`)
  await expect(page.getByRole('tab', { name: 'Xem' })).toHaveAttribute('aria-selected', 'true')
  await dockReady(page)
  await expect(page.getByRole('button', { name: 'Tô theo chữ mẫu →' })).toBeVisible()
})
