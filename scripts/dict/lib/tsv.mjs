// The shard row format (see scripts/dict/README.md): UTF-8 NFC, one entry per line, rows
// separated by LF with no trailing LF, no header, ten tab-separated columns. Writer and reader are
// inverses (unit-tested round trip); the client's reader follows the same rules.

export const COLUMNS = ['simp', 'trad', 'pinyin', 'hv', 'hvAlt', 'vi', 'en', 'hsk', 'pop', 'flags']

const BAD = /[\t\n\r]/

function check(value, what, extra) {
  if (BAD.test(value) || (extra && extra.test(value))) throw new Error(`TSV: ${what} contains a separator: ${JSON.stringify(value)}`)
  return value
}

/**
 * @param {{ simp: string, trad: string, pinyin: string, hv: string, hvAlt: string[], vi: string[],
 *   en: string[], hsk: number | null, pop: number, flags: string[] }} row  trad is the full form;
 *   it is written as '' when equal to simp
 */
export function formatRow(row) {
  const joinChecked = (list, sep, what) => list.map((s) => check(s, what, new RegExp(`\\${sep}`))).join(sep)
  if (!Number.isInteger(row.pop) || row.pop < 0 || row.pop > 100) throw new Error(`TSV: bad pop ${row.pop}`)
  return [
    check(row.simp, 'simp'),
    row.trad === row.simp ? '' : check(row.trad, 'trad'),
    check(row.pinyin, 'pinyin'),
    check(row.hv, 'hv'),
    joinChecked(row.hvAlt, '|', 'hvAlt'),
    joinChecked(row.vi, '/', 'vi'),
    joinChecked(row.en, '/', 'en'),
    row.hsk == null ? '' : String(row.hsk),
    String(row.pop),
    joinChecked(row.flags, ',', 'flags'),
  ].join('\t')
}

const split = (s, sep) => (s ? s.split(sep) : [])

/** Inverse of formatRow; trad comes back as the full form. */
export function parseRow(line) {
  const c = line.split('\t')
  if (c.length !== COLUMNS.length) throw new Error(`TSV: expected ${COLUMNS.length} columns, got ${c.length}`)
  return {
    simp: c[0],
    trad: c[1] || c[0],
    pinyin: c[2],
    hv: c[3],
    hvAlt: split(c[4], '|'),
    vi: split(c[5], '/'),
    en: split(c[6], '/'),
    hsk: c[7] ? Number(c[7]) : null,
    pop: Number(c[8]),
    flags: split(c[9], ','),
  }
}

/** Rows to shard text (LF-separated, no trailing LF). */
export const formatShard = (rows) => rows.map(formatRow).join('\n')

/** Shard text to rows. */
export const parseShard = (text) => (text ? text.split('\n').map(parseRow) : [])
