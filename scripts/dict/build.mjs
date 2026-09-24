// npm run data:build — builds the dictionary, stroke and license files under public/ from the
// inputs pinned in sources.lock.json (fetched by data:fetch):
//   parse → join CVDICT (5 passes) → normalize senses → Hán Việt → overrides → HSK → rank → flags
//   → validation gates → public/dict/v1/ (manifest + shards), public/strokes/v2.0.1/,
//   public/licenses/, data/build-report.json.
// `--check` (npm run data:check) runs everything up to and including the gates, writes nothing.
// Any failed gate exits with code 1 before anything is written. See scripts/dict/README.md.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { dedupeEntries, parseCedict, parseKey } from './lib/cedict.mjs'
import { compareRows, entryFlags, FLAGS, isProperNoun, popularity, rankScore } from './lib/flags.mjs'
import { charTableRow, createHanViet, parseWordlist, readCharTable, taiwanReading, wordReading } from './lib/hanviet.mjs'
import { hash8, sha256 } from './lib/hash.mjs'
import { byFrequency, matchHskWord, readHskChars, readHskWords, refineHskKeys } from './lib/hsk.mjs'
import { isVariantOnly, joinVietnamese, variantTargets } from './lib/join.mjs'
import { createKeyIndex } from './lib/keys.mjs'
import { checkNpmSource, fileOf, loadLock, localPathOf, readPinned } from './lib/lock.mjs'
import { manifestSources, noticeProblems, thirdPartyNotices } from './lib/notices.mjs'
import { readCuratedTsv, STATUS_FLAG } from './lib/overrides.mjs'
import {
  DICT_OUT,
  GOLDEN_DIR,
  LICENSES_OUT,
  OVERRIDES_DIR,
  REPORT_FILE,
  resolveLocal,
  ROOT,
  STROKES_OUT,
  STROKES_VERSION,
} from './lib/paths.mjs'
import { allHan, isHan, marksToNumbered, syllables } from './lib/pinyin.mjs'
import { normalizeSenses, templateXrefs } from './lib/senses.mjs'
import { writeStamp } from './lib/stamp.mjs'
import { listStrokeFiles, strokeTreeHash } from './lib/strokes.mjs'
import { COLUMNS, formatRow, formatShard, parseShard } from './lib/tsv.mjs'
import { readUnihanZip } from './lib/unihan.mjs'
import { capitalize, isVietnameseSyllable, normalizeHvSyllable } from './lib/vietnamese.mjs'
import { readZipf } from './lib/wordfreq.mjs'

const CHECK_ONLY = process.argv.includes('--check')
const CORE_ROWS = 30_000
const REST_ROWS = 25_000
const COUNT_TOLERANCE = 0.02
const HV_COVERAGE_MIN = 0.985
/** Gold set: the algorithm may miss this many (conventional readings are the word overrides' job); the shipped column none. */
const GOLD_ALGORITHM_MISSES = 2
/** A license text shorter than this is not the license (an emptied or truncated file). */
const LICENSE_MIN_BYTES = 500

const timings = {}
let lap = performance.now()
function step(label) {
  const now = performance.now()
  timings[label] = Math.round(now - lap)
  lap = now
}

const report = { format: 1 }
const gates = []
const gate = (id, ok, detail) => gates.push({ id, ok: Boolean(ok), detail })

// ─── 1. Inputs, verified against the lock ─────────────────────────────────────────────────────
const lock = loadLock()
for (const s of lock.sources) if (s.npm) checkNpmSource(s)
const text = (buf) => buf.toString('utf8')

const ceFile = fileOf(lock, 'cc-cedict', 'entries')
const ceParsed = parseCedict(text(readPinned(ceFile, 'CC-CEDICT')))
const cvParsed = parseCedict(text(readPinned(fileOf(lock, 'cvdict', 'vietnamese'), 'CVDICT')))
const unihan = readUnihanZip(readPinned(fileOf(lock, 'unihan', 'unihan'), 'Unihan'))
const zipf = readZipf(readPinned(fileOf(lock, 'wordfreq', 'wordfreq'), 'wordfreq'))
const hskWords = readHskWords(text(readPinned(fileOf(lock, 'hsk30', 'words'), 'hsk30.csv')))
const hskChars = readHskChars(text(readPinned(fileOf(lock, 'hsk30', 'chars'), 'hsk30-chars.csv')))
const wordlist = parseWordlist(text(readPinned(fileOf(lock, 'hanviet-pinyin-words', 'readings'), 'hanvietData.js')))

const strokeFile = fileOf(lock, 'hanzi-writer-data', 'strokes')
const strokeDir = localPathOf(strokeFile)
const strokeFiles = listStrokeFiles(strokeDir)
const strokeTree = strokeTreeHash(strokeDir, strokeFiles)
gate(
  'checksums',
  strokeFiles.length === strokeFile.count && strokeTree === strokeFile.treeSha256,
  `every pinned input matched; stroke files ${strokeFiles.length}/${strokeFile.count}, tree ${strokeTree === strokeFile.treeSha256 ? 'ok' : `MISMATCH ${strokeTree}`}`,
)
const hasStrokes = new Set(strokeFiles.map((f) => f.char))
step('read + verify inputs')

// ─── 2. Entries: CC-CEDICT (deduplicated) + curated additions ─────────────────────────────────
const [ceEntries, ceDuplicates] = dedupeEntries(ceParsed.entries)
report.cedict = {
  headerEntries: Number(ceParsed.header.entries),
  date: ceParsed.header.date,
  linesParsed: ceParsed.entries.length,
  badLines: ceParsed.bad,
  duplicateKeysMerged: ceDuplicates,
  entries: ceEntries.length,
}
const cvFixes = cvParsed.fixesApplied
report.cvdict = { headerEntries: Number(cvParsed.header.entries), linesParsed: cvParsed.entries.length, badLines: cvParsed.bad, lineFixes: cvFixes }

const readOverrides = (name) => readCuratedTsv(fs.readFileSync(path.join(OVERRIDES_DIR, name), 'utf8'), name)
const viGloss = readOverrides('vi-gloss.tsv')
const hvWord = readOverrides('hanviet-word.tsv')
const hvChar = readOverrides('hanviet-char.tsv')
const extra = readOverrides('extra-entries.tsv')
const joinDeny = readOverrides('join-deny.tsv')
const notProper = readOverrides('not-proper-noun.tsv')
const charTable = readCharTable(hvChar)

const ceIndex = createKeyIndex(ceEntries)
const extraAdded = []
const extraSkipped = []
for (const x of extra) {
  const k = parseKey(x.key)
  if (!k) throw new Error(`extra-entries.tsv: bad key ${x.key}`)
  const existing = ceIndex.resolve(x.key)
  if (existing) {
    // CC-CEDICT has it now: its entry wins, the curated senses become an ordinary gloss override.
    extraSkipped.push(`${x.key} → ${existing}`)
    viGloss.push({ key: existing, vi: x.vi, source: x.source, status: x.status })
    continue
  }
  extraAdded.push({ key: x.key, trad: k.trad, simp: k.simp, py: k.py, defs: [], extra: x })
}
const entries = [...ceEntries, ...extraAdded]
const index = createKeyIndex(entries)
step('parse entries')

// ─── 3. CVDICT joined onto CC-CEDICT ──────────────────────────────────────────────────────────
const denyUnresolved = joinDeny.filter((r) => !ceIndex.has(r.key)).map((r) => r.key)
const { vi: cvByKey, stats: joinStats } = joinVietnamese(ceEntries, cvParsed.entries, { deny: new Set(joinDeny.map((r) => r.key)) })
report.join = joinStats
step('join CVDICT')

// ─── 4. Overrides resolved to current keys ─────────────────────────────────────────────────────
function resolveOverrides(rows, file) {
  const byKey = new Map()
  const loose = []
  const unresolved = []
  for (const r of rows) {
    const key = index.resolve(r.key)
    if (!key) unresolved.push(r.key)
    else {
      if (key !== r.key) loose.push(`${r.key} → ${key}`)
      if (byKey.has(key)) throw new Error(`${file}: two rows for ${key}`)
      byKey.set(key, r)
    }
  }
  return { byKey, loose, unresolved }
}
const glossOv = resolveOverrides(viGloss, 'vi-gloss.tsv')
const hvOv = resolveOverrides(hvWord, 'hanviet-word.tsv')
const notProperOv = resolveOverrides(notProper, 'not-proper-noun.tsv')
report.overrides = {
  viGloss: { rows: viGloss.length, applied: glossOv.byKey.size, resolvedLoosely: glossOv.loose, unresolved: glossOv.unresolved },
  hanvietWord: { rows: hvWord.length, applied: hvOv.byKey.size, resolvedLoosely: hvOv.loose, unresolved: hvOv.unresolved },
  hanvietChar: { rows: hvChar.length },
  extraEntries: { rows: extra.length, added: extraAdded.length, nowInCedict: extraSkipped },
  joinDeny: { rows: joinDeny.length, unresolved: denyUnresolved },
  notProperNoun: { rows: notProper.length, applied: notProperOv.byKey.size, unresolved: notProperOv.unresolved },
}
gate(
  'overrides-resolve',
  !glossOv.unresolved.length && !hvOv.unresolved.length && !denyUnresolved.length && !notProperOv.unresolved.length,
  `vi-gloss unresolved ${glossOv.unresolved.length}, hanviet-word ${hvOv.unresolved.length}, join-deny ${denyUnresolved.length} ${denyUnresolved.slice(0, 3).join(' ')}, not-proper-noun ${notProperOv.unresolved.length}`,
)
// Curated readings: each syllable must look like a Vietnamese syllable (typos, junk); '-' = loanword.
const badShape = []
for (const r of hvWord) {
  if (r.hanviet === '-') continue
  for (const alt of r.hanviet.split('|')) for (const s of alt.trim().split(/\s+/)) if (!isVietnameseSyllable(s)) badShape.push(`${r.key}: "${s}"`)
}
for (const r of hvChar) for (const s of r.hanviet.split('|')) if (!isVietnameseSyllable(s.trim())) badShape.push(`${r.char} ${r.pinyin}: "${s}"`)
gate('overrides-shape', !badShape.length, `${badShape.length} curated readings that are not Vietnamese syllables ${badShape.slice(0, 5).join('; ')}`)

// ─── 5. Hán Việt ──────────────────────────────────────────────────────────────────────────────
const readingsByTrad = new Map()
for (const e of entries) {
  const list = readingsByTrad.get(e.trad) ?? []
  list.push(syllables(e.py))
  readingsByTrad.set(e.trad, list)
}
const hanviet = createHanViet({ wordlist, unihan, readingsOf: (t) => readingsByTrad.get(t) ?? [], charTable })
const howCounts = {}
function algorithmicReading(e, properNoun, count = true) {
  const resolved = hanviet.resolveChars(e.trad, syllables(e.py), { taiwan: taiwanReading(e.defs) })
  if (count) for (const r of resolved ?? []) if (r.han) howCounts[r.how] = (howCounts[r.how] ?? 0) + 1
  return wordReading(resolved, { properNoun })
}
/**
 * One curated word reading in the dictionary's spelling. Every syllable is capitalized for a
 * proper noun; otherwise a capital the curator wrote is kept (汉语 "Hán ngữ": a language, not a name).
 */
const normalizeHvWord = (hv, properNoun) =>
  hv === '-'
    ? '-'
    : hv
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => (properNoun || /^\p{Lu}/u.test(s) ? capitalize(normalizeHvSyllable(s)) : normalizeHvSyllable(s)))
        .join(' ')
/** A curated reading cell: "thuỵ giác|thuỵ giáo" → the reading shipped and its searchable alternates. */
const curatedReading = (cell, properNoun) => {
  const [main, ...alts] = cell.split('|').map((s) => normalizeHvWord(s.trim(), properNoun))
  return { hv: main, alts: alts.filter((a) => a && a !== '-' && a !== main) }
}

// ─── 6. HSK 3.0 levels ────────────────────────────────────────────────────────────────────────
const hskByKey = new Map()
const hskMissing = []
const hskPerLevel = {}
const entryByKey = new Map(entries.map((e) => [e.key, e]))
const hskDropped = []
const hskSwapped = []
for (const w of hskWords) {
  hskPerLevel[w.level] = (hskPerLevel[w.level] ?? 0) + 1
  const matched = matchHskWord(w, (k) => index.resolve(k), (s) => index.bySimp(s))
  const { keys, dropped, swapped } = refineHskKeys(w, matched, {
    entryOf: (k) => entryByKey.get(k),
    bySimp: (s) => index.bySimp(s),
    resolveKey: (k) => index.resolve(k),
    variantTargetsOf: variantTargets,
  })
  hskDropped.push(...dropped)
  hskSwapped.push(...swapped)
  if (!keys.length) hskMissing.push(w)
  for (const k of keys) hskByKey.set(k, Math.min(hskByKey.get(k) ?? 9, w.level))
}
// A list key that is now only "variant of X" (電視臺 for 电视台) tags X, the entry with the senses.
// A curated gloss or reading written for the list's key follows the tag (複習 → 復習 for 复习).
const hskMoved = []
const overridesMoved = []
for (const [k, level] of [...hskByKey]) {
  const e = entryByKey.get(k)
  if (!isVariantOnly(e.defs)) continue
  const targets = [...new Set(variantTargets(e.defs).map((t) => index.resolve(t)).filter(Boolean))]
  if (targets.length !== 1 || entryByKey.get(targets[0]).simp !== e.simp) continue
  hskByKey.delete(k)
  hskByKey.set(targets[0], Math.min(hskByKey.get(targets[0]) ?? 9, level))
  hskMoved.push(`${k} → ${targets[0]}`)
  for (const [name, ov] of [
    ['vi-gloss', glossOv],
    ['hanviet-word', hvOv],
  ]) {
    if (!ov.byKey.has(k) || ov.byKey.has(targets[0])) continue
    ov.byKey.set(targets[0], ov.byKey.get(k))
    ov.byKey.delete(k)
    overridesMoved.push(`${name} ${k} → ${targets[0]}`)
  }
}
step('HSK')

// ─── 7. Rows ──────────────────────────────────────────────────────────────────────────────────
const pinlu = new Map()
for (const [ch, o] of unihan) {
  if (!o.kHanyuPinlu) continue
  const m = new Map()
  for (const r of o.kHanyuPinlu.matchAll(/([^\s(]+)\((\d+)\)/g)) m.set(marksToNumbered(r[1]).toLowerCase(), Number(r[2]))
  pinlu.set(ch, m)
}

const refCounts = { resolved: 0, unresolved: 0 }
const refsUnresolved = []
const viCounts = { cvdict: 0, 'curated-ai': 0, curated: 0, template: 0, none: 0, cvdictSameAsEnglish: 0 }
const hvStats = { override: 0, loanword: 0, algorithm: 0, none: 0, low: 0, nom: 0, charTable: 0 }
const hvRedundant = []
const sameSenses = (a, b) => a.length === b.length && a.every((s, i) => s === b[i])

// wordfreq counts written forms, not readings: rows that share a form with a more common row of it
// get the secondary penalty (flags.mjs rankScore).
const isSingle = (e) => [...e.simp].length === 1 && syllables(e.py).length === 1
const commonSingles = new Set(entries.filter((e) => isSingle(e) && !isProperNoun(e.py)).map((e) => e.simp))
const variantOfSibling = (e) =>
  variantTargets(e.defs).some((t) => {
    const k = index.resolve(t)
    return k !== null && k !== e.key && entryByKey.get(k)?.simp === e.simp
  })
const secondaryRows = { properNounBesideCommon: 0, variantOfSameForm: 0 }

const rows = entries.map((e) => {
  const notProperNoun = notProperOv.byKey.has(e.key)
  const properNoun = isProperNoun(e.py) && !notProperNoun

  // Vietnamese: curated override > curated extra entry > CVDICT > cross-reference template > none.
  let vi = []
  let viSource = null
  const cur = glossOv.byKey.get(e.key) ?? e.extra
  if (cur) {
    vi = normalizeSenses(cur.vi.split('/'), { vietnamese: true })
    viSource = STATUS_FLAG[cur.status] === 'cur' ? 'curated' : 'curated-ai'
  } else if (cvByKey.has(e.key)) {
    vi = normalizeSenses(cvByKey.get(e.key).defs, { vietnamese: true, index, refCounts, unresolvedSeen: refsUnresolved })
    viSource = 'cvdict'
    // Kept on purpose: these are mostly names and terms Vietnamese writes the same way (Kenya,
    // karate, protein), not untranslated sentences.
    if (sameSenses(vi, normalizeSenses(e.defs, { index }))) viCounts.cvdictSameAsEnglish++
  }
  if (!vi.length) {
    const t = templateXrefs(e.defs)
    if (t) {
      vi = normalizeSenses(t, { vietnamese: true, index, refCounts, unresolvedSeen: refsUnresolved })
      viSource = 'template'
    }
  }
  viCounts[viSource ?? 'none']++
  const en = vi.length ? [] : normalizeSenses(e.defs, { index, refCounts, unresolvedSeen: refsUnresolved })

  // Hán Việt: word override > algorithm (with the character table).
  let hv = ''
  let hvAlt = []
  let hvLow = false
  let hvNom = false
  let hvCurated = null
  const ov = hvOv.byKey.get(e.key)
  if (ov) {
    ;({ hv, alts: hvAlt } = curatedReading(ov.hanviet, properNoun))
    hvCurated = ov.status
    hvStats[hv === '-' ? 'loanword' : 'override']++
    const r = algorithmicReading(e, properNoun) // still counted, for the resolution statistics
    // An override the algorithm now gets right on its own (the character table fixed it) is dead weight.
    if (r && r.hv === hv && !hvAlt.length) hvRedundant.push(e.key)
  } else {
    const r = algorithmicReading(e, properNoun)
    if (r) {
      hv = r.hv
      hvAlt = r.alts
      hvLow = r.low
      hvNom = r.nom
      hvCurated = r.curated
      hvStats.algorithm++
      if (hvLow) hvStats.low++
      if (hvNom) hvStats.nom++
      if (hvCurated) hvStats.charTable++
    } else if ([...e.trad].some(isHan)) hvStats.none++
  }

  const hsk = hskByKey.get(e.key) ?? null
  const single = isSingle(e)
  const pnBesideCommon = single && properNoun && commonSingles.has(e.simp)
  const variantOfForm = variantOfSibling(e)
  if (pnBesideCommon) secondaryRows.properNounBesideCommon++
  if (variantOfForm) secondaryRows.variantOfSameForm++
  const score = rankScore({
    zipf: zipf.get(e.simp) ?? 0,
    defs: e.defs,
    py: e.py,
    properNoun,
    single,
    pinlu: single ? (pinlu.get(e.simp) ?? pinlu.get(e.trad)) : null,
    secondary: pnBesideCommon || variantOfForm,
  })
  const chars = new Set([...e.simp, ...e.trad].filter(isHan))
  const noStroke = [...chars].some((c) => !hasStrokes.has(c))
  return {
    key: e.key,
    simp: e.simp,
    trad: e.trad,
    py: e.py,
    pinyin: e.py,
    hv,
    hvAlt,
    vi,
    en,
    hsk,
    score,
    pop: popularity(score, hsk),
    flags: entryFlags({ py: e.py, defs: e.defs, viSource, enShown: en.length > 0, hvLow, hvNom, hvCurated, noStroke, notProperNoun, added: !!e.extra }),
    defs: e.defs,
    zipf: zipf.has(e.simp),
  }
})
rows.sort(compareRows)
step('rows (senses, Hán Việt, rank)')

// ─── 8. Gates on the rows ─────────────────────────────────────────────────────────────────────
const expected = lock.sources.find((s) => s.id === 'cc-cedict').expect.entries
const drift = Math.abs(rows.length - expected) / expected
const cvExpected = lock.sources.find((s) => s.id === 'cvdict').expect.entries
const cvDrift = Math.abs(cvParsed.entries.length - cvExpected) / cvExpected
gate(
  'entry-count',
  drift <= COUNT_TOLERANCE && cvDrift <= COUNT_TOLERANCE,
  `${rows.length} rows vs ${expected} CC-CEDICT entries expected (${(drift * 100).toFixed(2)}% drift); CVDICT ${cvParsed.entries.length} vs ${cvExpected} (${(cvDrift * 100).toFixed(2)}%); limit ±${COUNT_TOLERANCE * 100}%`,
)
gate(
  'cedict-parse',
  ceParsed.bad.length === 0 && ceParsed.entries.length === report.cedict.headerEntries,
  `${ceParsed.entries.length} lines parsed of the ${report.cedict.headerEntries} its header announces, ${ceParsed.bad.length} bad`,
)
gate('cvdict-fixes', Object.values(cvFixes).every((n) => n > 0), `line fixes applied: ${JSON.stringify(cvFixes)}; unparsed lines ${cvParsed.bad.length}`)

const notNfc = []
const emptyMeaning = []
const sylMismatch = []
for (const r of rows) {
  const cells = [r.simp, r.trad, r.pinyin, r.hv, ...r.hvAlt, ...r.vi, ...r.en]
  if (cells.some((c) => c !== c.normalize('NFC'))) notNfc.push(r.key)
  if (!r.vi.length && !r.en.length) emptyMeaning.push(r.key)
  if (allHan(r.simp) && allHan(r.trad)) {
    const n = [...r.simp].length
    const tokens = syllables(r.pinyin)
    // A few characters are read as two syllables (瓩 qian1wa3 "thiên ngoã"): count tone digits.
    const spoken = tokens.reduce((k, t) => k + Math.max(1, (t.match(/[1-5]/g) ?? []).length), 0)
    const hvN = r.hv && r.hv !== '-' ? r.hv.split(' ').length : spoken
    if (tokens.length !== n || [...r.trad].length !== n || hvN !== spoken || r.hvAlt.some((a) => a.split(' ').length !== spoken)) {
      sylMismatch.push(r.key)
    }
  }
}
// No row may ship a character's vernacular form (hanviet-char.tsv) as its Hán Việt, curated word
// readings included: 读者 is never "đọc giả".
const vernacularShipped = []
for (const r of rows) {
  const chars = [...r.trad]
  const pys = syllables(r.pinyin)
  if (!r.hv || r.hv === '-' || !allHan(r.trad) || chars.length !== pys.length) continue
  for (const reading of [r.hv, ...r.hvAlt]) {
    const syl = reading.toLowerCase().split(' ')
    if (syl.length !== chars.length) continue
    chars.forEach((c, i) => {
      const t = charTableRow(charTable, c, pys[i].toLowerCase())
      if (t?.vernacular.includes(syl[i])) vernacularShipped.push(`${r.key} "${reading}"`)
    })
  }
}
gate('hv-vernacular', !vernacularShipped.length, `${vernacularShipped.length} rows ship a vernacular form hanviet-char.tsv rules out ${vernacularShipped.slice(0, 5).join(' ')}`)
gate('nfc', !notNfc.length, `${notNfc.length} rows not NFC ${notNfc.slice(0, 5).join(' ')}`)
gate('meaning', !emptyMeaning.length, `${emptyMeaning.length} rows with neither vi nor en ${emptyMeaning.slice(0, 5).join(' ')}`)
gate('syllables', !sylMismatch.length, `${sylMismatch.length} all-Han rows whose pinyin/Hán Việt syllables ≠ characters ${sylMismatch.slice(0, 5).join(' ')}`)

const allHanRows = rows.filter((r) => allHan(r.trad))
const hvCovered = allHanRows.filter((r) => r.hv !== '').length
const hvCoverage = hvCovered / allHanRows.length
gate('hv-coverage', hvCoverage >= HV_COVERAGE_MIN, `${hvCovered}/${allHanRows.length} all-Han rows have a Hán Việt reading (${(hvCoverage * 100).toFixed(2)}%, minimum ${HV_COVERAGE_MIN * 100}%)`)

// Gold 40: the algorithm alone and the shipped column, against hand-checked readings.
const gold = fs
  .readFileSync(path.join(GOLDEN_DIR, 'hanviet-gold.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const [simp, trad, py, want, note] = l.split('\t')
    return { simp, trad, py, want: want.split('|'), note }
  })
const hvCompare = (s) => normalizeHvWord(s, false).toLowerCase()
const goldRow = (g) => rows.find((r) => r.trad === g.trad && r.simp === g.simp && r.py.toLowerCase() === g.py.toLowerCase())
const goldResults = gold.map((g) => {
  const row = goldRow(g)
  const e = row ? { trad: row.trad, py: row.py, defs: row.defs } : { trad: g.trad, py: g.py, defs: [] }
  const algo = wordReading(hanviet.resolveChars(e.trad, syllables(e.py), { taiwan: taiwanReading(e.defs) }))?.hv ?? ''
  const shipped = row?.hv ?? ''
  const ok = (got) => g.want.some((w) => hvCompare(w) === hvCompare(got))
  return { word: g.simp, want: g.want.join('|'), algorithm: algo, algorithmOk: ok(algo), shipped, shippedOk: ok(shipped) }
})
const goldAlgo = goldResults.filter((r) => r.algorithmOk).length
const goldShipped = goldResults.filter((r) => r.shippedOk).length
gate(
  'gold',
  goldAlgo >= gold.length - GOLD_ALGORITHM_MISSES && goldShipped === gold.length,
  `algorithm ${goldAlgo}/${gold.length} (minimum ${gold.length - GOLD_ALGORITHM_MISSES}), shipped ${goldShipped}/${gold.length} (all)`,
)

const l1Missing = hskMissing.filter((w) => w.level === 1)
gate('hsk-l1', !l1Missing.length, `${l1Missing.length} HSK 3.0 level-1 words without an entry ${l1Missing.map((w) => w.simp).join(' ')}`)
// The credits page says HSK 1–2 words were rewritten: every one of them must carry a curated gloss.
const hskUncurated = rows.filter((r) => r.hsk !== null && r.hsk <= 2 && !r.flags.includes('cur') && !r.flags.includes('cur-ai'))
gate('hsk12-curated', !hskUncurated.length, `${hskUncurated.length} HSK 1–2 rows without a curated gloss ${hskUncurated.slice(0, 5).map((r) => r.key).join(' ')}`)

const problems = noticeProblems(lock)
for (const t of lock.licenseTexts) {
  const file = resolveLocal(t.from)
  if (!fs.existsSync(file)) problems.push(`license text ${t.file}: ${t.from} missing`)
  else if (fs.statSync(file).size < LICENSE_MIN_BYTES) problems.push(`license text ${t.file}: ${t.from} is ${fs.statSync(file).size} bytes, not a license`)
}
gate('notices', !problems.length, problems.length ? problems.join('; ') : `${lock.sources.length} sources, ${lock.licenseTexts.length} license texts`)
step('gates')

// ─── 9. Report ────────────────────────────────────────────────────────────────────────────────
const flagCounts = Object.fromEntries(FLAGS.map((f) => [f, rows.filter((r) => r.flags.includes(f)).length]))
const hskTagged = rows.filter((r) => r.hsk != null)
const writing = { 1: [], 2: [], 3: [] }
for (const c of hskChars) if (c.writingLevel) writing[c.writingLevel].push(c.char)
// The writing lists in the order a learner meets the characters in text: wordfreq's frequency of
// every word containing the character, summed (the list's own order, alphabetical by pinyin, breaks
// ties). The list's "Freq" column counts HSK words per character, which puts 我 (3) after 爸 (2)…
// and far behind 不 (207), so it is not used.
const writingSet = new Set(Object.values(writing).flat())
const charFreq = new Map()
for (const [word, z] of zipf) {
  for (const c of word) if (writingSet.has(c)) charFreq.set(c, (charFreq.get(c) ?? 0) + 10 ** z)
}
for (const l of [1, 2, 3]) writing[l] = byFrequency(writing[l], (c) => charFreq.get(c) ?? 0)

/** A sense as a prompt line: notes in parentheses and cross-reference notation dropped (the client's plainSense, simplified). */
function firstGloss(senses) {
  for (const s of senses) {
    if (/^\s*lượng từ\s*:/i.test(s)) continue
    let t = s
    for (let prev = ''; prev !== t; ) {
      prev = t
      t = t.replace(/\s*[(（][^()（）]*[)）]/g, '')
    }
    t = t
      .replace(/([^\s|[\]]+)\|([^\s|[\]]+)\[[^\]]*\]/g, '$2')
      .replace(/([^\s|[\]]+)\[[^\]]*\]/g, '$1')
      .replace(/\s+([;,])/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/^[\s;,:]+|[\s;,:]+$/g, '')
    if (t) return t
  }
  return ''
}

// The word each level-1 writing character is learned in (a quick-add card's context: its reading
// and a meaning a beginner can use, 么 in 什么, 汉 in 汉语): the lowest-level HSK word with the
// character, several characters long before the character alone, then the most common. None when
// that is the character itself. [key, first meaning, true when the word is a proper noun (中国:
// its capital does not make 中 a name)].
const hskContext = {}
for (const c of writing[1]) {
  const cands = hskTagged.filter((r) => r.simp.includes(c) && [...r.simp].length === syllables(r.pinyin).length && r.vi.length)
  cands.sort((a, b) => a.hsk - b.hsk || ([...a.simp].length === 1) - ([...b.simp].length === 1) || b.pop - a.pop)
  const best = cands[0]
  if (best && best.simp !== c) hskContext[c] = best.flags.includes('pn') ? [best.key, firstGloss(best.vi), true] : [best.key, firstGloss(best.vi)]
}
report.rows = rows.length
report.vi = {
  rowsWithVietnamese: rows.filter((r) => r.vi.length).length,
  fromCvdict: viCounts.cvdict,
  curatedAi: viCounts['curated-ai'],
  curatedReviewed: viCounts.curated,
  fromTemplate: viCounts.template,
  englishFallback: rows.filter((r) => r.en.length).length,
  cvdictSameAsEnglish: viCounts.cvdictSameAsEnglish,
  crossReferences: { ...refCounts, unresolvedExamples: refsUnresolved.slice(0, 40) },
}
report.hanviet = {
  allHanRows: allHanRows.length,
  allHanRowsWithReading: hvCovered,
  coverage: Number(hvCoverage.toFixed(5)),
  rowsFromOverride: hvStats.override,
  loanwordRows: hvStats.loanword,
  rowsFromAlgorithm: hvStats.algorithm,
  rowsLowConfidence: hvStats.low,
  rowsLowConfidenceUnihan: hvStats.nom,
  rowsWithCharacterTableReading: hvStats.charTable,
  wordOverridesTheAlgorithmNowMatches: hvRedundant,
  rowsWithHanButNoReading: hvStats.none,
  rowsWithAlternates: rows.filter((r) => r.hvAlt.length).length,
  characterResolutions: howCounts,
  gold: { algorithm: goldAlgo, shipped: goldShipped, of: gold.length, misses: goldResults.filter((r) => !r.algorithmOk || !r.shippedOk) },
}
report.hsk = {
  wordsPerLevel: hskPerLevel,
  wordsMatched: hskWords.length - hskMissing.length,
  wordsMissing: hskMissing.map((w) => `${w.id} ${w.simp}`),
  tagsMovedFromVariantEntries: hskMoved,
  curatedRowsThatFollowedTheTag: overridesMoved,
  tagsLeftToTheMainForm: hskDropped,
  tagsMovedFromProperNounToCommonWord: hskSwapped,
  rowsTagged: hskTagged.length,
  rowsTaggedPerLevel: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((l) => [l, hskTagged.filter((r) => r.hsk === l).length])),
  writingList: Object.fromEntries(Object.entries(writing).map(([l, cs]) => [l, cs.length])),
  writingCharsWithoutStrokes: Object.values(writing).flat().filter((c) => !hasStrokes.has(c)),
}
report.rank = { rowsWithWordfreq: rows.filter((r) => r.zipf).length, secondaryPenalty: secondaryRows, top20: rows.slice(0, 20).map((r) => `${r.simp}[${r.py}]`).join(' ') }
report.flags = flagCounts
report.strokes = { files: strokeFiles.length, entriesMissingStrokes: flagCounts.nostroke }
report.gates = gates

const failed = gates.filter((g) => !g.ok)
for (const g of gates) console.log(`${g.ok ? '  pass' : '  FAIL'}  ${g.id.padEnd(18)} ${g.detail}`)
if (failed.length) {
  console.error(`\ndata:${CHECK_ONLY ? 'check' : 'build'} failed: ${failed.map((g) => g.id).join(', ')}`)
  process.exit(1)
}
if (CHECK_ONLY) {
  console.log(`\nAll gates passed (${rows.length} rows); --check writes nothing.`)
  process.exit(0)
}

// ─── 10. Output ───────────────────────────────────────────────────────────────────────────────
/** Writes a file only when its content changed (keeps rebuilds and file watchers quiet). */
function writeIfChanged(file, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file)
    if (old.equals(buf)) return false
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  return true
}
/** Removes files in `dir` that this build did not produce. */
function prune(dir, keep) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (!keep.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
  }
}

// Stroke files, byte for byte, plus the availability list and the license beside them.
const strokesKeep = new Set()
let strokeBytes = 0
for (const f of strokeFiles) {
  const name = `${f.hex}.json`
  const buf = fs.readFileSync(path.join(strokeDir, f.name))
  writeIfChanged(path.join(STROKES_OUT, name), buf)
  strokeBytes += buf.length
  strokesKeep.add(name)
}
const available = strokeFiles.map((f) => f.char).join('')
const availableName = `available.${hash8(Buffer.from(available))}.txt`
writeIfChanged(path.join(STROKES_OUT, availableName), available)
const arphic = readPinned(fileOf(lock, 'hanzi-writer-data', 'license'), 'ARPHICPL.TXT')
writeIfChanged(path.join(STROKES_OUT, 'ARPHICPL.TXT'), arphic)
writeIfChanged(
  path.join(STROKES_OUT, 'README.md'),
  `# Stroke data ${STROKES_VERSION}\n\nOne file per character, named by its code point in lowercase hex (5b66.json = 学), copied unmodified from hanzi-writer-data ${STROKES_VERSION.slice(1)} (derived from Make Me a Hanzi and fonts by Arphic Technology). Licensed under the Arphic Public License: see ARPHICPL.TXT. ${availableName} lists every character that has a file.\n`,
)
for (const n of [availableName, 'ARPHICPL.TXT', 'README.md']) strokesKeep.add(n)
prune(STROKES_OUT, strokesKeep)
step('write strokes')

// Dictionary shards.
const shardSpecs = [{ name: 'core', from: 0, to: Math.min(CORE_ROWS, rows.length) - 1 }]
for (let from = CORE_ROWS, i = 1; from < rows.length; from += REST_ROWS, i++) {
  shardSpecs.push({ name: `rest-${i}`, from, to: Math.min(from + REST_ROWS, rows.length) - 1 })
}
const shards = shardSpecs.map((s) => {
  const content = Buffer.from(formatShard(rows.slice(s.from, s.to + 1)), 'utf8')
  return { ...s, content, file: `${s.name}.${hash8(content)}.tsv`, sha256: sha256(content), bytes: content.length }
})
const hskWriting = { 1: writing[1], 2: writing[2], 3: writing[3] }
report.hsk.writingOrderFirst20 = writing[1].slice(0, 20).join('')
report.hsk.level1Context = Object.keys(hskContext).length
const sources = manifestSources(lock)
const dataVersion = `${(report.cedict.date || '').slice(0, 10).replace(/-/g, '')}-${hash8(
  Buffer.from(JSON.stringify([shards.map((s) => s.sha256), availableName, hskWriting, hskContext, sources])),
)}`
const manifest = {
  format: 1,
  dataVersion,
  columns: COLUMNS,
  rows: rows.length,
  license: 'CC BY-SA 4.0',
  notices: 'licenses/THIRD_PARTY_NOTICES.md',
  shards: shards.map((s) => ({ file: s.file, from: s.from, to: s.to, bytes: s.bytes, sha256: s.sha256 })),
  strokes: { base: `strokes/${STROKES_VERSION}/`, available: `strokes/${STROKES_VERSION}/${availableName}`, count: strokeFiles.length },
  hskWriting,
  hskContext,
  flags: FLAGS,
  sources,
}
for (const s of shards) writeIfChanged(path.join(DICT_OUT, s.file), s.content)
writeIfChanged(path.join(DICT_OUT, 'manifest.json'), `${JSON.stringify(manifest)}\n`) // fetched on every start: compact
prune(DICT_OUT, new Set([...shards.map((s) => s.file), 'manifest.json']))
step('write dictionary')

// Licenses and notices.
const licenseKeep = new Set(['THIRD_PARTY_NOTICES.md'])
for (const t of lock.licenseTexts) {
  writeIfChanged(path.join(LICENSES_OUT, t.file), fs.readFileSync(resolveLocal(t.from), 'utf8').replace(/\r\n/g, '\n'))
  licenseKeep.add(t.file)
}
const notices = thirdPartyNotices(lock, { dataVersion, rows: rows.length })
writeIfChanged(path.join(LICENSES_OUT, 'THIRD_PARTY_NOTICES.md'), notices)
prune(LICENSES_OUT, licenseKeep)
step('write licenses')

// ─── 11. Read back what was written ───────────────────────────────────────────────────────────
const readBack = []
let checkRow = 0
for (const s of manifest.shards) {
  const buf = fs.readFileSync(path.join(DICT_OUT, s.file))
  if (sha256(buf) !== s.sha256 || buf.length !== s.bytes) readBack.push(`${s.file}: checksum`)
  const parsed = parseShard(buf.toString('utf8'))
  if (parsed.length !== s.to - s.from + 1) readBack.push(`${s.file}: ${parsed.length} rows`)
  // Through the reader and back through the writer, every row must come out as the build made it.
  for (const p of parsed) {
    if (formatRow(p) !== formatRow(rows[checkRow++])) {
      readBack.push(`${s.file}: row ${checkRow - 1} differs`)
      break
    }
  }
}
for (const src of lock.sources) if (!notices.includes(`### ${src.name}`)) readBack.push(`notices: ${src.id} missing`)
for (const f of lock.licenseTexts) if (!fs.existsSync(path.join(LICENSES_OUT, f.file))) readBack.push(`licenses/${f.file} missing`)
if (readBack.length) {
  console.error(`\ndata:build: the written files do not read back: ${readBack.join('; ')}`)
  process.exit(1)
}
step('read back')

const gz = (buf) => gzipSync(buf, { level: 9 }).length
report.dataVersion = dataVersion
report.shards = shards.map((s) => ({ file: s.file, rows: s.to - s.from + 1, bytes: s.bytes, gzipBytes: gz(s.content) }))
report.shardTotals = { bytes: shards.reduce((n, s) => n + s.bytes, 0), gzipBytes: report.shards.reduce((n, s) => n + s.gzipBytes, 0) }
report.strokes.bytes = strokeBytes
report.strokes.available = { file: availableName, bytes: Buffer.byteLength(available), gzipBytes: gz(Buffer.from(available)) }
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 1)}\n`)
step('report')
// What this build was made from: `npm run data:ensure` skips the next build while that still holds.
writeStamp(dataVersion)

const total = Object.values(timings).reduce((a, b) => a + b, 0)
console.log(`\nWrote ${rows.length} rows in ${shards.length} shards (${(report.shardTotals.bytes / 1048576).toFixed(2)} MB, ${(report.shardTotals.gzipBytes / 1048576).toFixed(2)} MB gzip), ${strokeFiles.length} stroke files, ${lock.licenseTexts.length + 1} license files.`)
console.log(`Data version ${dataVersion}. Report: ${path.relative(ROOT, REPORT_FILE)}.`)
console.log(`Timings (ms): ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(' · ')} · total ${total}`)
