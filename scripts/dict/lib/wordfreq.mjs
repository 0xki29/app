// wordfreq 3.1.1's large_zh list (CC BY-SA 4.0 data), decoded in Node: gzip → msgpack →
// [header, bucket 0, bucket 1, …], where bucket i holds the words at −i centibels, i.e. Zipf
// (900 − i) / 100. Keys are simplified ("oversimplified") Chinese.
import { Buffer } from 'node:buffer'
import { gunzipSync } from 'node:zlib'
import { decode } from '@msgpack/msgpack'
import { unzipSync } from 'fflate'

export const WORDFREQ_MEMBER = 'wordfreq/data/large_zh.msgpack.gz'

/** The large_zh member out of the wheel (a zip file). */
export function extractFromWheel(wheelBytes, member = WORDFREQ_MEMBER) {
  const files = unzipSync(new Uint8Array(wheelBytes), { filter: (f) => f.name === member })
  if (!files[member]) throw new Error(`wordfreq wheel: ${member} not found`)
  return Buffer.from(files[member])
}

/** Map<word, zipf> from the gzipped msgpack list; a word's first (highest) bucket wins. */
export function readZipf(gzBytes) {
  const data = decode(gunzipSync(gzBytes))
  if (!Array.isArray(data) || typeof data[0] !== 'object') throw new Error('wordfreq: unexpected format')
  const header = data[0]
  if (header.format !== 'cB') throw new Error(`wordfreq: unexpected header ${JSON.stringify(header)}`)
  const zipf = new Map()
  for (let i = 1; i < data.length; i++) {
    const z = (900 - (i - 1)) / 100
    for (const w of data[i]) if (!zipf.has(w)) zipf.set(w, z)
  }
  return zipf
}
