import { expect, practiceUrl, test, traceCharacter } from './fixtures'

// When the network lets the app down: a request that never answers, a data file that fails or is
// missing, storage the browser refuses. The learner gets a result or a message with a way on,
// never a spinner for good, and never a developer's message.

// The browser reports the failed requests these tests provoke.
test.use({ expectedErrors: [/Failed to load resource/] })

test('scoring does not wait for good on a stroke file that never arrives: it scores against the font (PERF-1)', async ({ page }) => {
  // The request is never answered (a stalled mobile connection).
  await page.route('**/strokes/v2.0.1/6c38.json', () => {})
  await page.goto(practiceUrl('永'))
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, '永')
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await expect(page.locator('section.result')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Đang chấm…')).toHaveCount(0)
})

test('Hôm nay: a failed data list on the first visit offers a retry, and the HSK quick-add comes back (PERF-2, DECK-8)', async ({ page }) => {
  await page.route('**/dict/v1/manifest.json', (route) => route.abort('internetdisconnected'))
  await page.goto('./')
  await expect(page.getByText('Chưa tải được danh sách chữ HSK 1. Hãy kiểm tra kết nối mạng rồi thử lại.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/dữ liệu từ điển chưa được tạo|npm run/)).toHaveCount(0)
  await page.unroute('**/dict/v1/manifest.json')
  await page.getByRole('button', { name: 'Thử tải lại danh sách chữ HSK' }).click()
  await expect(page.getByRole('button', { name: 'Thêm 10 chữ HSK 1' })).toBeVisible()
})

test('Tra cứu: a missing data manifest says so plainly, with a retry that works (M11)', async ({ page, context }) => {
  // context.route: the dictionary fetches from its worker.
  await context.route('**/dict/v1/manifest.json', (route) => route.fulfill({ status: 404, body: 'not found' }))
  await page.goto('./#/tra-cuu')
  const notice = page.getByRole('alert')
  await expect(notice).toContainText('Chưa tải được dữ liệu từ điển', { timeout: 20_000 })
  await expect(notice).not.toContainText('npm')
  await context.unroute('**/dict/v1/manifest.json')
  await notice.getByRole('button', { name: 'Thử lại' }).click()
  await page.getByRole('searchbox').fill('xuesheng')
  await expect(page.locator('.dict-hit').first()).toContainText('学生', { timeout: 30_000 })
})

test.describe('the browser keeps no data (private mode, storage blocked)', () => {
  test.use({ expectedErrors: [] })

  test('"+ Ôn tập" says why it cannot add, instead of doing nothing (DECK-7)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined })
    })
    await page.goto(practiceUrl('永'))
    const chip = page.getByRole('button', { name: 'Thêm vào sổ ôn tập' })
    await expect(chip).toHaveAttribute('aria-disabled', 'true')
    // Still pressable (aria-disabled): it says why.
    await chip.click({ force: true })
    await expect(page.locator('.toast--auto')).toContainText('Trình duyệt không cho lưu dữ liệu')
  })
})
