import { expect, practiceUrl, readScore, strokePoints, test, touchscreen, traceCharacter, writingBox } from './fixtures'

// Writing with real touch events in the browser (the input policy's unit tests use a fake DOM), in
// free practice of 永 (5 strokes).
const FIRST = '永'

test.beforeEach(async ({ page }) => {
  await page.goto(practiceUrl(FIRST))
})

test('Tô theo: a character written with a finger scores like one written with the mouse', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, FIRST, { input: 'touch' })
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  expect(await readScore(page)).toBeGreaterThanOrEqual(80)
  await expect(page.getByText('5/5 nét đúng', { exact: true })).toBeVisible()
})

test('a hand resting on the box does not block the finger, and leaves no dot behind (EI-2)', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  const next = page.locator('.stroke-num[data-state="next"]')
  await expect(next).toHaveText('1')
  const box = await writingBox(page)
  // A hand edge, 50 px wide (under the palm-size limit), resting still for 400 ms before the finger writes.
  const hand = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.9, id: 2, radius: 25 }
  const touch = await touchscreen(page)
  await touch.send('touchStart', [hand])
  await page.waitForTimeout(400)
  // The finger writes stroke 1 while the hand rests; then both lift.
  await touch.write(await strokePoints(page, FIRST, 0), [hand])
  await touch.detach()
  // One stroke: the finger's. The hand is no dot.
  await expect(next).toHaveText('2')
  await expect(page.locator('.stroke-num[data-state="done"]')).toHaveCount(1)
  await traceCharacter(page, FIRST, { strokes: [1, 2, 3, 4] })
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await expect(page.getByText('5/5 nét đúng', { exact: true })).toBeVisible()
})

test('a still press held on the box counts as a stroke in the review too: the verdict says why (EI-1)', async ({ page }) => {
  await page.getByRole('tab', { name: 'Nhớ lại' }).click()
  await traceCharacter(page, FIRST)
  const box = await writingBox(page)
  await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.93)
  await page.mouse.down()
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await readScore(page)
  await expect(page.locator('.result__tally')).toContainText('1 thừa')
  await expect(page.locator('.result__issues')).toContainText('Nét thừa')
  await expect(page.getByText('Rất tốt', { exact: true })).toHaveCount(0)
})
