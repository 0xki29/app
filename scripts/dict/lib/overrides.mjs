// Curated files in data/overrides/ (CC BY-SA 4.0, human- or AI-edited, reviewed in git): UTF-8,
// tab-separated, "#" comment lines, then a header row naming the columns.

/** Statuses a curated row can have, and the flag each one sets on the entry. */
export const STATUS_FLAG = {
  'ai-draft': 'cur-ai', // "hiệu đính bởi AI, chờ duyệt"
  reviewed: 'cur', // "đã hiệu đính": checked by a person
}

/** Rows of a curated TSV as objects keyed by the header's column names. */
export function readCuratedTsv(text, file = 'curated file') {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
  if (!lines.length) return []
  const head = lines[0].split('\t')
  return lines.slice(1).map((l, i) => {
    const cells = l.split('\t')
    if (cells.length !== head.length) {
      throw new Error(`${file}: row ${i + 1} has ${cells.length} columns, expected ${head.length}: ${l}`)
    }
    const row = Object.fromEntries(head.map((h, j) => [h, cells[j].normalize('NFC').trim()]))
    // An empty cell would ship as an empty meaning or reading under a curated label.
    const empty = head.find((h) => !row[h])
    if (empty) throw new Error(`${file}: row ${i + 1} has an empty "${empty}" (write "-" where a column allows it): ${l}`)
    if ('status' in row && !(row.status in STATUS_FLAG)) {
      throw new Error(`${file}: row ${i + 1} has unknown status "${row.status}" (use ${Object.keys(STATUS_FLAG).join(' or ')})`)
    }
    return row
  })
}
