import { entryUrl, expect, test } from './fixtures'

// The pages that explain: the pinyin guide (reached by tapping an entry's pinyin) and the credits
// page, generated from the data manifest, whose license files must really be in the build.

test('tapping the pinyin opens "Pinyin cho người Việt"; its contents jump within the page', async ({ page }) => {
  await page.goto(entryUrl('學生|学生[xue2 sheng5]'))
  await page.getByRole('link', { name: /^Pinyin: xué sheng/ }).click()
  await expect(page).toHaveURL(/#\/pinyin$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pinyin cho người Việt')
  const toc = page.getByRole('navigation', { name: 'Mục lục' })
  await expect(toc.getByRole('link')).toHaveText(['Thanh điệu', 'Phụ âm đầu', 'Vần', 'Quy tắc viết', 'Biến điệu'])
  for (const h of ['1. Thanh điệu', '2. Phụ âm đầu', '3. Vần', '4. Quy tắc viết (để đọc cho đúng)', '5. Biến điệu']) {
    await expect(page.getByRole('heading', { level: 2, name: h })).toBeAttached()
  }
  // The parts fold (a phone screen): the tones are open, the others closed until asked for.
  const toggle = (name: string) => page.getByRole('heading', { level: 2, name }).getByRole('button')
  await expect(toggle('1. Thanh điệu')).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle('5. Biến điệu')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Hai thanh 3 liền nhau: chữ đầu đọc thành thanh 2.')).toBeHidden()
  // An in-page jump, not a route change (the router owns the hash): it opens the part.
  await toc.getByRole('link', { name: 'Biến điệu' }).click()
  await expect(page.getByRole('heading', { level: 2, name: '5. Biến điệu' })).toBeFocused()
  await expect(toggle('5. Biến điệu')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Hai thanh 3 liền nhau: chữ đầu đọc thành thanh 2.')).toBeVisible()
  await expect(page).toHaveURL(/#\/pinyin$/)
  await toggle('1. Thanh điệu').click()
  await expect(toggle('1. Thanh điệu')).toHaveAttribute('aria-expanded', 'false')
  // Everything open: no Mandarin syllable is spelled in Vietnamese letters ("phiên âm bồi").
  await page.getByRole('button', { name: 'Mở tất cả các phần' }).click()
  const guide = page.locator('main')
  for (const bad of ['“liêu”', '“tuây”', '“chuân”', '“buô”', '“Hả?”', 'nặng – nhẹ']) await expect(guide).not.toContainText(bad)
  await expect(guide).toContainText('jun, qun, xun, yun')
  // Back to the entry it was opened from.
  await page.getByRole('link', { name: 'Quay lại' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('学生')
})

test('credits: every data source with its license, and the license files are in the build', async ({ page, request }) => {
  await page.goto('./#/nguon-du-lieu')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giới thiệu & nguồn dữ liệu')
  const sources = page.locator('.dict-source-item__name')
  for (const name of ['CC-CEDICT', 'CVDICT', 'hanviet-pinyin-words', 'Unihan', 'wordfreq', 'HSK 3.0', 'hanzi-writer-data']) {
    await expect(sources.filter({ hasText: name }), name).toHaveCount(1)
  }
  await expect(page.getByText('Mã nguồn theo giấy phép MIT', { exact: false })).toBeVisible()
  await expect(page.locator('.dict-trust')).toContainText('bản dịch máy')
  await expect(page.locator('.dict-trust')).toContainText('hiệu đính bởi AI, chờ duyệt')

  // Every local link (license texts, notices, the plain data files) answers 200.
  const hrefs = await page
    .locator('.dict-credits a[href]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin)))
  const files = [...new Set(hrefs.map((h) => h.split('#')[0]))].filter((h) => !h.endsWith('/'))
  expect(files.filter((f) => f.includes('/licenses/')).length).toBeGreaterThanOrEqual(6)
  expect(files.filter((f) => f.endsWith('.tsv')).length).toBe(5)
  for (const f of files) expect((await request.get(f)).status(), f).toBe(200)
  const notices = await (await request.get(files.find((f) => f.endsWith('THIRD_PARTY_NOTICES.md'))!)).text()
  expect(notices).toContain('CC-CEDICT')
  expect(notices).toContain('Arphic')
})
