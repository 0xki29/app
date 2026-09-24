import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { dockReady, expect, practiceUrl, test, traceCharacter } from './fixtures'

// The review deck on the real data: HSK quick-add, a session with a new card (Xem → Tô theo →
// Nhớ lại → rating), what a reload keeps, and a review card brought in by importing a deck file.
// Each test starts with an empty browser profile, so an empty deck.

const count = (page: Page, label: 'Cần ôn' | 'Chữ mới') => page.locator('.today__count').filter({ hasText: label }).locator('dd')

test('an empty deck offers the next 10 characters of the HSK 1 writing list', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Sổ ôn tập đang trống' })).toBeVisible()
  await page.getByRole('button', { name: 'Thêm 10 chữ HSK 1' }).click({ timeout: 20_000 })
  // Most frequent first (的 是 一 …), each with the word it is learned in.
  await expect(page.locator('.page__msg')).toHaveText(/^Đã thêm 10 chữ: 的 是 一 (\p{Script=Han} ){6}\p{Script=Han}$/u)
  await expect(count(page, 'Chữ mới')).toHaveText('10')
  await expect(count(page, 'Cần ôn')).toHaveText('0')
  await expect(page.getByRole('link', { name: 'Bắt đầu ôn' })).toBeVisible()
  await page.getByRole('link', { name: 'Sổ ôn tập', exact: true }).click()
  await expect(page.locator('.deck-card')).toHaveCount(10)
  await expect(page.locator('.deck-card').first()).toContainText('Chưa học')
  await expect(page.locator('.deck-card').first()).toContainText('真的 · thật')
})

test('a session with one new card: Xem → Tô theo → Nhớ lại → Đúng, kept over a reload', async ({ page }) => {
  // 米 (not one of the test fixtures: its strokes come from the data build), added from free practice.
  await page.goto(practiceUrl('米'))
  await page.getByRole('button', { name: 'Thêm vào sổ ôn tập' }).click()
  await expect(page.getByRole('button', { name: 'Đã có trong sổ ôn tập' })).toBeVisible()
  // Opened directly, "Quay lại" goes home.
  await page.getByRole('button', { name: 'Quay lại' }).click()
  await expect(count(page, 'Chữ mới')).toHaveText('1')
  await page.getByRole('link', { name: 'Bắt đầu ôn' }).click()

  // A new card: all three steps, starting with Xem; the prompt from the dictionary.
  await expect(page.getByRole('tab')).toHaveText(['Xem', 'Tô theo', 'Nhớ lại'])
  await expect(page.getByRole('tab', { name: 'Xem' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.topbar__progress')).toContainText('1 / 1')
  await expect(page.locator('.prompt__pinyin')).toContainText('mǐ')
  await dockReady(page)
  await page.getByRole('button', { name: 'Tô theo chữ mẫu →' }).click()
  await expect(page.getByRole('tab', { name: 'Tô theo' })).toHaveAttribute('aria-selected', 'true')
  await traceCharacter(page, '米')
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await expect(page.getByText('6/6 nét đúng', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tiếp tục →' }).click()

  // Nhớ lại: the character is not shown until the answer is.
  await expect(page.getByRole('tab', { name: 'Nhớ lại' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('img', { name: 'Ô viết chữ', exact: true })).toBeVisible()
  await expect(page.locator('.prompt')).not.toContainText('米')
  await traceCharacter(page, '米')
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await expect(page.getByRole('group', { name: 'Tự đánh giá' })).toBeVisible()
  await page.getByRole('button', { name: 'Đúng', exact: true }).click()

  // The summary takes focus, and the last rating and the results are announced (DECK-5).
  await expect(page.getByRole('heading', { name: 'Xong buổi ôn' })).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: '米 → Đúng. 1 chữ, 1 lượt tự đánh giá' })).toHaveCount(1)
  await expect(page.locator('.session-summary__lead')).toHaveText('1 chữ · 1 lượt tự đánh giá')
  await expect(page.locator('.session-summary__count[data-v="correct"]')).toContainText('1')
  // FSRS: a new card rated Đúng comes back within minutes, the same day.
  await expect(page.getByText(/^Lần ôn tới: sau \d+ phút\.$/)).toBeVisible()
  await page.getByRole('link', { name: 'Về trang Hôm nay' }).click()
  await expect(page.getByText(/^Hôm nay đã ôn xong\./)).toBeVisible()

  await page.reload()
  await expect(page.getByText(/^Hôm nay đã ôn xong\./)).toBeVisible()
  await expect(page.getByText('1 chữ vừa học sẽ cần ôn lại trong hôm nay, sau ít phút.')).toBeVisible()
  await page.getByRole('link', { name: 'Sổ ôn tập', exact: true }).click()
  await expect(page.locator('.deck-card')).toHaveCount(1)
  await expect(page.locator('.deck-card')).toContainText('Đang học')
})

test('import brings in a due review card (Nhớ lại only); export has every card and review', async ({ page }, testInfo) => {
  // 你, learned five days ago (Đúng, then Đúng again 10 minutes later): due again two days later.
  const day = 86_400_000
  const now = Date.now()
  const file = {
    format: 'chinese-notebook-deck',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    cards: [
      { id: 'c:4f60#write', char: '你', addedAt: now - 5 * day, context: { key: '你好|你好[ni3 hao3]', simp: '你好', pinyin: 'ni3 hao3', vi: 'xin chào' } },
    ],
    reviews: [
      { cardId: 'c:4f60#write', at: now - 5 * day + 60_000, rating: 'correct', mode: 'new', prevState: 'new', durationMs: 30_000 },
      { cardId: 'c:4f60#write', at: now - 5 * day + 15 * 60_000, rating: 'correct', mode: 'again', prevState: 'learning', durationMs: 20_000 },
    ],
    meta: { settings: { newPerDay: 10, dayStartHour: 4 }, hskCursor: {} },
  }
  await page.goto('./#/so-on-tap')
  await expect(page.getByText('Sổ chưa có chữ nào.')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'so-on-tap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(page.locator('.page__msg')).toHaveText('Đã nhập: 1 thẻ mới, 2 lượt ôn.')
  await expect(page.locator('.deck-card')).toContainText('Đang ôn · ôn bây giờ')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Xuất dữ liệu' }).click()
  const saved = testInfo.outputPath('export.json')
  await (await download).saveAs(saved)
  const exported = JSON.parse(readFileSync(saved, 'utf8')) as { format: string; cards: { char: string; fsrs: { state: string } }[]; reviews: unknown[] }
  expect(exported.format).toBe('chinese-notebook-deck')
  expect(exported.cards.map((c) => `${c.char} ${c.fsrs.state}`)).toEqual(['你 review'])
  expect(exported.reviews).toHaveLength(2)

  await page.getByRole('link', { name: 'Hôm nay', exact: true }).click()
  await expect(count(page, 'Cần ôn')).toHaveText('1')
  await page.getByRole('link', { name: 'Bắt đầu ôn' }).click()
  // A review: Nhớ lại only, the character masked in its word, "Không nhớ?" offered.
  await expect(page.getByRole('tab')).toHaveText(['Nhớ lại'])
  await expect(page.locator('.prompt__context')).toContainText('＿好 · xin chào')
  await expect(page.getByRole('button', { name: 'Không nhớ?' })).toBeVisible()
  await traceCharacter(page, '你')
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await expect(page.getByRole('group', { name: 'Tự đánh giá' })).toBeVisible()
  await page.getByRole('button', { name: 'Đúng', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Xong buổi ôn' })).toBeVisible()
  // The summary is still part of the session (no navigation bar).
  await page.goto('./#/so-on-tap')
  await expect(page.locator('.deck-card')).toContainText(/Đang ôn · ôn (sau \d+ ngày|ngày mai)/)
})
