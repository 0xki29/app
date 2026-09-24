// Parser for the CC-CEDICT line format, which CVDICT shares:
//   Traditional Simplified [pin1 yin1] /sense 1/sense 2/
// Pure; unit-tested. Input may use CRLF (the MDBG export does) and may start with a BOM.

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/

/**
 * Known malformed lines, repaired before parsing. Each must match at least once in the input it is
 * meant for, so a fix that no longer applies is noticed (see `fixesApplied`).
 */
export const LINE_FIXES = [
  {
    id: 'cvdict-double-bracket',
    note: 'CVDICT: 澳洲廣播電臺 has its pinyin in double brackets, "[[Ao4 … tai2] ]"',
    from: /^(\S+ \S+) \[\[([^\]]*)\] \] /,
    to: '$1 [$2] ',
  },
]

/** The stable entry key used everywhere: "trad|simp[numbered pinyin]". */
export const entryKey = (trad, simp, py) => `${trad}|${simp}[${py}]`

/** Inverse of entryKey; null for anything else. */
export function parseKey(key) {
  const m = /^([^|[\]]+)\|([^|[\]]+)\[([^\]]*)\]$/.exec(key)
  return m ? { trad: m[1], simp: m[2], py: m[3] } : null
}

/**
 * Parses a CC-CEDICT-format file. Returns the `#!` header fields, the entries in file order (senses
 * split on "/", empty ones dropped), the lines that did not parse, and how often each fix applied.
 */
export function parseCedict(text, { fixes = LINE_FIXES } = {}) {
  const header = {}
  const entries = []
  const bad = []
  const fixesApplied = Object.fromEntries(fixes.map((f) => [f.id, 0]))
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (let raw of lines) {
    if (!raw) continue
    if (raw.startsWith('#')) {
      const h = /^#! ?([a-z]+)=(.*)$/.exec(raw)
      if (h) header[h[1]] = h[2].trim()
      continue
    }
    for (const f of fixes) {
      if (f.from.test(raw)) {
        raw = raw.replace(f.from, f.to)
        fixesApplied[f.id]++
      }
    }
    const m = LINE.exec(raw)
    if (!m) {
      bad.push(raw)
      continue
    }
    const defs = m[4]
      .split('/')
      .map((d) => d.trim())
      .filter(Boolean)
    entries.push({ trad: m[1], simp: m[2], py: m[3].trim().replace(/\s+/g, ' '), defs })
  }
  return { header, entries, bad, fixesApplied }
}

/**
 * Merges entries with the same key (CC-CEDICT has a few exact duplicate headword lines, such as two
 * 和 he2): senses are concatenated in order, repeats dropped. Returns [entries, duplicatesMerged].
 */
export function dedupeEntries(entries) {
  const byKey = new Map()
  let merged = 0
  for (const e of entries) {
    const key = entryKey(e.trad, e.simp, e.py)
    const prev = byKey.get(key)
    if (prev) {
      merged++
      for (const d of e.defs) if (!prev.defs.includes(d)) prev.defs.push(d)
    } else {
      byKey.set(key, { key, trad: e.trad, simp: e.simp, py: e.py, defs: [...e.defs] })
    }
  }
  return [[...byKey.values()], merged]
}
