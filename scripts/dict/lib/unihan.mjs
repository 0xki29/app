// The few Unihan 18.0.0 fields the build uses, read straight from Unihan.zip.
import { strFromU8, unzipSync } from 'fflate'

/** Fields the Hán Việt step and the polyphone ranking read. */
export const UNIHAN_FIELDS = [
  'kVietnamese', // low-confidence Hán Việt fallback (mixes in Nôm readings)
  'kMandarin', // a hint for which reading a neutral-tone syllable stands for
  'kHanyuPinlu', // reading frequencies: orders the readings of polyphones
  'kTraditionalVariant',
  'kSemanticVariant',
  'kZVariant',
]

const FILES = ['Unihan_Readings.txt', 'Unihan_Variants.txt']

/** "U+4E7E<kMatthews" → "乾" */
export const cpToChar = (s) => String.fromCodePoint(parseInt(s.replace(/^U\+/, '').split('<')[0], 16))

/** Parses Unihan text lines ("U+4E00\tkField\tvalue") into Map<char, {field: value}>. */
export function parseUnihanText(text, fields = UNIHAN_FIELDS, into = new Map()) {
  const want = new Set(fields)
  for (const line of text.split('\n')) {
    if (!line.startsWith('U+')) continue
    const [cp, field, value] = line.replace(/\r$/, '').split('\t')
    if (!want.has(field)) continue
    const ch = cpToChar(cp)
    let o = into.get(ch)
    if (!o) into.set(ch, (o = {}))
    o[field] = value
  }
  return into
}

/** Reads the fields from the zip's Readings and Variants files. */
export function readUnihanZip(zipBytes, fields = UNIHAN_FIELDS) {
  const files = unzipSync(new Uint8Array(zipBytes), { filter: (f) => FILES.includes(f.name) })
  const out = new Map()
  for (const name of FILES) {
    if (!files[name]) throw new Error(`Unihan.zip: ${name} not found`)
    parseUnihanText(strFromU8(files[name]), fields, out)
  }
  return out
}

/** Variant characters of `ch` from the given fields, in field order, without `ch` itself. */
export function variantsOf(unihan, ch, fields = ['kTraditionalVariant', 'kSemanticVariant', 'kZVariant']) {
  const o = unihan.get(ch)
  const out = []
  if (!o) return out
  for (const f of fields) {
    for (const t of (o[f] || '').split(/\s+/).filter(Boolean)) {
      const v = cpToChar(t)
      if (v !== ch && !out.includes(v)) out.push(v)
    }
  }
  return out
}
