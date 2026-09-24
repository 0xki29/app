import { practiceHref } from '../app/router'

/**
 * Where the dictionary's screens live (hash routes, wired in the app shell) and the outside links.
 */

export const SEARCH_PATH = '/tra-cuu'
export const PINYIN_HREF = '#/pinyin'
export const CREDITS_HREF = '#/nguon-du-lieu'
export const DECK_HREF = '#/so-on-tap'

export function searchHref(q = ''): string {
  return q ? `#${SEARCH_PATH}?q=${encodeURIComponent(q)}` : `#${SEARCH_PATH}`
}

let lastSearch = searchHref()
let lastPage = searchHref()

/** The search screen notes its query here, so an entry's back link returns to the same results. */
export function rememberSearch(href: string): void {
  lastSearch = href
  lastPage = href
}

export function lastSearchHref(): string {
  return lastSearch
}

/** The last search or entry shown: where the pinyin guide and the credits page go back to. */
export function rememberPage(href: string): void {
  lastPage = href
}

export function lastPageHref(): string {
  return lastPage
}

export function entryHref(key: string): string {
  return `#/tu/${encodeURIComponent(key)}`
}

/** Free practice of one character (all three tabs), by code point: 学 → #/luyen/5b66 (the app's router). */
export { practiceHref }

export const REPO_URL = 'https://github.com/0xki29/app'

/**
 * A new GitHub issue about an entry, prefilled. Only the entry and the data version go in: nothing
 * about the person (GitHub shows who files it, on their own account).
 */
export function reportIssueUrl(key: string, dataVersion?: string): string {
  const title = `[Từ điển] ${key}`
  const body = [
    `Mục từ: ${key}`,
    `Phiên bản dữ liệu: ${dataVersion ?? '(không rõ)'}`,
    '',
    'Sai ở đâu? (nghĩa tiếng Việt / pinyin / âm Hán Việt / cấp HSK / khác)',
    '',
    '',
    'Nên sửa thành:',
    '',
    '',
    'Nguồn tham khảo (nếu có):',
    '',
  ].join('\n')
  const params = new URLSearchParams({ title, body })
  return `${REPO_URL}/issues/new?${params.toString()}`
}
