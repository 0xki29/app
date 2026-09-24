// Regenerates the small test fixtures from the real inputs (run by hand after `npm run data:fetch`;
// the tests themselves never touch the network or the cache):
//   node scripts/dict/test/make-fixtures.mjs
// gold-cedict.u8   — every CC-CEDICT line whose headword is one of the gold-set words
// gold-unihan.txt  — the Unihan fields the Hán Việt step reads, for those words' characters and
//                    their variants
import fs from 'node:fs'
import path from 'node:path'
import console from 'node:console'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { fileOf, loadLock, readPinned } from '../lib/lock.mjs'
import { GOLDEN_DIR } from '../lib/paths.mjs'
import { UNIHAN_FIELDS, cpToChar } from '../lib/unihan.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const lock = loadLock()
const gold = fs
  .readFileSync(path.join(GOLDEN_DIR, 'hanviet-gold.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split('\t'))
const trads = new Set(gold.map((g) => g[1]))

const ce = readPinned(fileOf(lock, 'cc-cedict', 'entries')).toString('utf8')
const ceLines = ce.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && trads.has(l.split(' ')[0]))
fs.writeFileSync(path.join(here, 'fixtures/gold-cedict.u8'), `${ceLines.join('\n')}\n`)

const zip = unzipSync(new Uint8Array(readPinned(fileOf(lock, 'unihan', 'unihan'))), {
  filter: (f) => f.name === 'Unihan_Readings.txt' || f.name === 'Unihan_Variants.txt',
})
const lines = [...strFromU8(zip['Unihan_Readings.txt']).split('\n'), ...strFromU8(zip['Unihan_Variants.txt']).split('\n')]
  .map((l) => l.replace(/\r$/, ''))
  .filter((l) => l.startsWith('U+') && UNIHAN_FIELDS.includes(l.split('\t')[1]))
const chars = new Set([...trads].flatMap((t) => [...t]))
const VARIANT_FIELDS = ['kTraditionalVariant', 'kSemanticVariant', 'kZVariant']
for (const l of lines) {
  const [cp, field, value] = l.split('\t')
  if (chars.has(cpToChar(cp)) && VARIANT_FIELDS.includes(field)) for (const v of value.split(/\s+/)) chars.add(cpToChar(v))
}
const unihanLines = lines.filter((l) => chars.has(cpToChar(l.split('\t')[0])))
fs.writeFileSync(path.join(here, 'fixtures/gold-unihan.txt'), `${unihanLines.join('\n')}\n`)
console.log(`gold-cedict.u8: ${ceLines.length} lines; gold-unihan.txt: ${unihanLines.length} lines`)
