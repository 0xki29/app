import type { Page } from '@playwright/test'
import { entryUrl, expect, test, traceCharacter } from './fixtures'

// The dictionary on the real data (npm run data:build): search, entry pages, "Thêm vào sổ ôn tập",
// "Luyện viết" and back. Each test starts with an empty browser profile: the dictionary downloads
// and indexes its core, and the deck is empty.

const XUESHENG = '學生|学生[xue2 sheng5]'

/** Types a query and waits for its own results (not the previous query's, shown dimmed meanwhile). */
async function search(page: Page, q: string) {
  await page.getByRole('searchbox').fill(q)
  await page.waitForFunction((hash) => location.hash === hash, `#/tra-cuu?q=${encodeURIComponent(q)}`)
  await expect(page.locator('.dict-results--stale')).toHaveCount(0)
  await expect(page.locator('.dict-results, .dict-empty').first()).toBeVisible({ timeout: 30_000 })
}

const topHit = (page: Page) => page.locator('.dict-hit').first()

test('search: hanzi, pinyin, Hán Việt and meaning, with or without tones and diacritics', async ({ page }) => {
  await page.goto('./#/tra-cuu')
  await expect(page.getByRole('searchbox')).toBeFocused()
  // Alternating the expected top hit, so each check reads the results of its own query.
  const cases: [string, string][] = [
    ['学生', '学生'],
    ['cảm ơn', '谢谢'],
    ['學生', '学生'],
    ['xiexie', '谢谢'],
    ['xuesheng', '学生'],
    ['cam on', '谢谢'],
    ['xue2sheng1', '学生'],
    ['xiè xie', '谢谢'],
    ['xuéshēng', '学生'],
    ['tạ tạ', '谢谢'],
    ['hoc sinh', '学生'],
    ['ngan hang', '银行'],
    ['HỌC SINH', '学生'],
  ]
  for (const [q, top] of cases) {
    await search(page, q)
    await expect(topHit(page).locator('.dict-hit__simp'), q).toHaveText(top)
  }
  await expect(topHit(page)).toContainText('xué sheng')
  await expect(topHit(page)).toContainText('học sinh')
  await expect(topHit(page)).toContainText('HSK 1')

  // A short Latin query that means several things is grouped.
  await search(page, 'an')
  await expect(page.locator('.dict-group__title')).toHaveText([/^Theo pinyin/, /^Theo âm Hán Việt/, /^Theo nghĩa/])
  // English only where there is no Vietnamese, and said so.
  await search(page, 'messenger')
  await expect(topHit(page)).toContainText('价')
  await expect(topHit(page)).toContainText('(tiếng Anh)')
  await search(page, 'qwxz')
  await expect(page.getByText('Không tìm thấy “qwxz”.')).toBeVisible()

  // Enter opens the best match; back returns to the same results.
  await search(page, 'xiexie')
  await page.getByRole('searchbox').press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('谢谢')
  await page.getByRole('link', { name: 'Tra cứu' }).first().click()
  await expect(page.getByRole('searchbox')).toHaveValue('xiexie')
  await expect(topHit(page).locator('.dict-hit__simp')).toHaveText('谢谢')
})

test('entry: pinyin with tones, listen, Âm Hán Việt, meanings and where they come from', async ({ page }) => {
  await page.goto(entryUrl(XUESHENG))
  const head = page.getByRole('heading', { level: 1 })
  await expect(head).toContainText('学生', { timeout: 20_000 })
  await expect(head).toContainText('學生')
  // Tone-colored syllables: xué (2) sheng (neutral); tapping them opens the pinyin guide.
  const pinyin = page.getByRole('link', { name: /^Pinyin: xué sheng/ })
  await expect(pinyin.locator('.dict-t2')).toHaveText('xué')
  await expect(pinyin.locator('.dict-t5')).toHaveText('sheng')
  await expect(page.getByRole('button', { name: 'Nghe cách đọc 学生' })).toBeVisible()
  await expect(page.locator('.dict-head__hv')).toHaveText('Âm Hán Việt học sinh')
  await expect(page.locator('.dict-head__tags')).toContainText('HSK 1')
  await expect(page.locator('.dict-chip')).toHaveText('hiệu đính bởi AI, chờ duyệt')
  await expect(page.locator('.dict-senses li').first()).toContainText('học sinh')
  // Its characters: reading, stroke-order preview, "Luyện viết" (and the traditional form of 学).
  const chars = page.locator('.dict-char')
  await expect(chars).toHaveCount(2)
  await expect(chars.nth(0)).toContainText('xué')
  await expect(chars.nth(0).getByRole('link', { name: 'Luyện viết', exact: true })).toHaveAttribute('href', '#/luyen/5b66')
  await expect(chars.nth(0).getByRole('link', { name: 'Luyện viết chữ phồn thể' })).toHaveAttribute('href', '#/luyen/5b78')
  await expect(page.locator('.dict-char svg').first()).toBeVisible()

  // A curated HSK 1 word, labelled as such.
  await page.goto(entryUrl('米飯|米饭[mi3 fan4]'))
  await expect(page.locator('.dict-head__hv')).toHaveText('Âm Hán Việt mễ phạn')
  await expect(page.locator('.dict-chip')).toHaveText('hiệu đính bởi AI, chờ duyệt')
  await expect(page.locator('.dict-senses li').first()).toHaveText('cơm; cơm trắng')

  // A proper noun: capitalized Hán Việt, a badge.
  await page.goto(entryUrl('北京|北京[Bei3 jing1]'))
  await expect(page.locator('.dict-head__hv')).toHaveText('Âm Hán Việt Bắc Kinh')
  await expect(page.locator('.dict-head__tags')).toContainText('Tên riêng')

  // No Vietnamese yet: the English, labelled.
  await page.goto(entryUrl('价|价[jie4]'))
  await expect(page.locator('.dict-chip')).toHaveText('chưa có bản dịch')
  await expect(page.locator('.dict-senses')).toHaveAttribute('lang', 'en')
})

test('entry: each character card is the character as the word writes it (H1, H2)', async ({ page }) => {
  // 头发 is 頭髮: its 发 is 髮 fà "tóc", not 發 fā "gửi".
  await page.goto(entryUrl('頭髮|头发[tou2 fa5]'))
  const fa = page.locator('.dict-char').nth(1)
  await expect(fa).toContainText('fà', { timeout: 20_000 })
  await expect(fa).toContainText('tóc')
  await expect(fa).toContainText('Phồn thể 髮')
  // 舞台's 台 is the stage (臺), never the classical "ông" row.
  await page.goto(entryUrl('舞台|舞台[wu3 tai2]'))
  const tai = page.locator('.dict-char').nth(1)
  await expect(tai).toContainText('tái')
  await expect(tai).not.toContainText('ông')
  // A common noun CC-CEDICT capitalizes is no "Tên riêng", its Hán Việt not capitalized throughout.
  await page.goto(entryUrl('星期天|星期天[Xing1 qi1 tian1]'))
  await expect(page.locator('.dict-head__hv')).toContainText('tinh kỳ thiên')
  await expect(page.locator('.dict-head')).not.toContainText('Tên riêng')
  // A loanword has no Hán Việt reading worth reading.
  await page.goto(entryUrl('巧克力|巧克力[qiao3 ke4 li4]'))
  await expect(page.locator('.dict-head__hv')).toContainText('không dùng — từ phiên âm')
  // A reading set by AI curation says so: 睡觉 thuỵ giác.
  await page.goto(entryUrl('睡覺|睡觉[shui4 jiao4]'))
  await expect(page.locator('.dict-head__hv')).toContainText('thuỵ giác')
  await expect(page.locator('.dict-head__hv')).toContainText('(AI đề xuất, chờ duyệt)')
})

test('entry: a character with several readings lists the others, each its own entry', async ({ page }) => {
  await page.goto(entryUrl('了|了[le5]'))
  await expect(page.getByRole('link', { name: /^Pinyin: le\b/ })).toBeVisible({ timeout: 20_000 })
  const others = page.getByRole('region', { name: 'Chữ này còn đọc là' })
  await expect(others).toContainText('liǎo')
  await others.getByRole('link').filter({ hasText: 'hoàn thành' }).click()
  await expect(page.getByRole('link', { name: /^Pinyin: liǎo/ })).toBeVisible()
  // Machine-translated meanings say so.
  await expect(page.locator('.dict-chip')).toHaveText('bản dịch máy')

  await page.goto(entryUrl('行|行[xing2]'))
  await expect(page.locator('.dict-head__hv')).toContainText('hành')
  await page.getByRole('region', { name: 'Chữ này còn đọc là' }).getByRole('link').filter({ hasText: 'háng' }).click()
  await expect(page.locator('.dict-head__hv')).toContainText('hàng')
})

test('Thêm vào sổ ôn tập: one writing card per character, the word as context; Today shows them', async ({ page }) => {
  await page.goto(entryUrl(XUESHENG))
  await expect(page.getByText('Mỗi chữ thành một thẻ luyện viết (学, 生), kèm từ này làm ngữ cảnh.')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Thêm vào sổ ôn tập' }).click()
  await expect(page.locator('.dict-add__msg')).toHaveText('Đã thêm 2 chữ vào sổ ôn tập.')
  await expect(page.getByRole('button', { name: '✓ Đã có trong sổ ôn tập' })).toBeVisible()

  await page.getByRole('link', { name: 'Hôm nay', exact: true }).click()
  await expect(page.locator('.today__count').filter({ hasText: 'Chữ mới' })).toContainText('2')
  await page.getByRole('link', { name: 'Sổ ôn tập', exact: true }).click()
  const cards = page.locator('.deck-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('学')
  await expect(cards.first()).toContainText('学生 · học sinh')
})

test('Luyện viết from an entry: free practice of the character, then back to the entry', async ({ page }) => {
  await page.goto(entryUrl(XUESHENG))
  await page.locator('.dict-char').first().getByRole('link', { name: 'Luyện viết', exact: true }).click({ timeout: 20_000 })
  await expect(page).toHaveURL(/#\/luyen\/5b66$/)
  await expect(page.getByRole('tab')).toHaveText(['Xem', 'Tô theo', 'Nhớ lại'])
  await expect(page.locator('.prompt__pinyin')).toContainText('xué')
  // 学 is not one of the test fixtures: its strokes come from the data build, like the app's.
  await page.getByRole('tab', { name: 'Tô theo' }).click()
  await traceCharacter(page, '学')
  await page.getByRole('button', { name: 'Chấm điểm' }).click()
  await expect(page.getByText('8/8 nét đúng', { exact: true })).toBeVisible()
  // "+ Ôn tập" adds the character alone.
  await page.getByRole('button', { name: 'Thêm vào sổ ôn tập' }).click()
  await expect(page.getByRole('button', { name: 'Đã có trong sổ ôn tập' })).toBeVisible()
  await page.getByRole('button', { name: 'Quay lại' }).click()
  await expect(page).toHaveURL(new RegExp(`#/tu/${escape(encodeURIComponent(XUESHENG))}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('学生')
})

/** A string as a literal inside a RegExp. */
function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
