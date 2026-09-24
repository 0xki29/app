import { expect, practiceUrl, readScore, test, traceCharacter, writingBox } from './fixtures'

// Regression tests for the practice flow, in free practice of 永 (5 strokes).
const FIRST = '永'

test.beforeEach(async ({ page }) => {
  await page.goto(practiceUrl(FIRST))
})

test('the headline does not praise strokes written backwards', async ({ page }) => {
  // The shape score cannot see direction, so it stays high; the verdict follows the strokes.
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, FIRST, { reversed: true })
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await expect(page.getByText('0/5 nét đúng', { exact: true })).toBeVisible()
  await expect(page.getByText('Thử lại', { exact: true })).toBeVisible()
  await expect(page.getByText('Rất tốt', { exact: true })).toHaveCount(0)
})

test('tapping the active tab again after scoring starts a fresh attempt', async ({ page }) => {
  const trace = page.getByRole('tab', { name: 'Tô theo' })
  await trace.click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await trace.click()
  await expect(page.getByRole('region', { name: /\d+ điểm/ })).toHaveCount(0)
  // No ink left to score: the scored strokes are gone, not kept in their verdict colors.
  await expect(page.getByRole('button', { name: 'Chấm điểm' })).toBeDisabled()
})

test('a tap is not a stroke: nothing to score, and the next-stroke badge stays on 1', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  // The badges are decoration (aria-hidden), so only their state attribute can be read.
  const next = page.locator('.stroke-num[data-state="next"]')
  await expect(next).toHaveText('1')
  const box = await writingBox(page)
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.3)
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7)
  await expect(page.getByRole('button', { name: 'Chấm điểm' })).toBeDisabled()
  await expect(next).toHaveText('1')
  // A real stroke does count.
  await traceCharacter(page, FIRST, { strokes: [0] })
  await expect(next).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Chấm điểm' })).toBeEnabled()
})

test('Nhớ lại: the box does not name the character until the answer is shown', async ({ page }) => {
  await page.getByRole('tab', { name: 'Nhớ lại' }).click()
  await expect(page.getByRole('img', { name: 'Ô viết chữ', exact: true })).toBeVisible()
  await expect(page.getByText('Viết chữ này từ trí nhớ')).toBeVisible()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await expect(page.getByRole('img', { name: `Ô viết chữ ${FIRST}` })).toBeVisible()
})

test('Nhớ lại: a second tap right after "Chấm điểm" does not rate, even on a rating button (A2)', async ({ page }) => {
  await page.getByRole('tab', { name: 'Nhớ lại' }).click()
  await traceCharacter(page, FIRST)
  // Whether the result's buttons were still guarded when the second tap came down.
  await page.evaluate(() => {
    document.addEventListener(
      'pointerdown',
      () => (document.documentElement.dataset.tapGuarded = String(document.querySelector<HTMLElement>('.result__body')?.inert)),
      true,
    )
  })
  const button = await page.getByRole('button', { name: 'Chấm điểm' }).boundingBox()
  if (!button) throw new Error('"Chấm điểm" is not visible')
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2)
  // The rating replaces it: tap the first rating button as soon as it is there.
  const rating = page.locator('.result__rate .btn').first()
  await rating.waitFor()
  const target = await rating.boundingBox()
  if (!target) throw new Error('No rating button')
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2)
  await expect(page.locator('html'), 'the second tap must land while the guard holds, or this proves nothing').toHaveAttribute(
    'data-tap-guarded',
    'true',
  )
  await readScore(page)
  // Not rated: the rating is still asked for, on the same recall.
  await expect(page.getByRole('group', { name: 'Tự đánh giá' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Nhớ lại' })).toHaveAttribute('aria-selected', 'true')
})

test('reduced motion: the result buttons look unready while they ignore taps (F4)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  // A class, not the role: a guarded (inert) button is not in the accessibility tree yet.
  const button = page.locator('.result__actions .btn--primary')
  await button.waitFor()
  // Read at once, in one go: whether the guard still holds, and how the button looks.
  const early = await button.evaluate((el) => ({
    guarded: el.closest('.result__body')!.hasAttribute('data-guard'),
    opacity: getComputedStyle(el).opacity,
  }))
  expect(early.guarded, 'read while the guard holds, or this proves nothing').toBe(true)
  expect(Number(early.opacity)).toBeLessThan(1)
  await expect(button).toHaveCSS('opacity', '1')
})

test('tapping the active tab while writing keeps the ink (F1)', async ({ page }) => {
  const trace = page.getByRole('tab', { name: 'Tô theo' })
  await trace.click()
  await traceCharacter(page, FIRST, { strokes: [0, 1, 2] })
  const next = page.locator('.stroke-num[data-state="next"]')
  await expect(next).toHaveText('4')
  await trace.click()
  await expect(next).toHaveText('4')
  await expect(page.getByRole('button', { name: 'Hoàn tác' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Chấm điểm' })).toBeEnabled()
})

test('Nhớ lại: the answer seen stays noted through another tab and back, until rated (F3)', async ({ page }) => {
  const recall = page.getByRole('tab', { name: 'Nhớ lại' })
  await recall.click()
  await traceCharacter(page, FIRST)
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  // Locked once the answer is shown: tapping it again says why and changes nothing.
  await recall.click()
  await expect(page.locator('.toast')).toHaveText('Đã hiện mẫu: hãy tự đánh giá')
  await expect(page.getByRole('group', { name: 'Tự đánh giá' })).toBeVisible()
  // Leaving and coming back is allowed, but the prompt remembers the answer was seen.
  await page.getByRole('tab', { name: 'Xem' }).click()
  await recall.click()
  await expect(page.getByText('Viết chữ này từ trí nhớ · bạn vừa xem mẫu')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Ô viết chữ', exact: true })).toBeVisible()
})
