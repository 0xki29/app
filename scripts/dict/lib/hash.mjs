// Checksums for the lock file and the emitted, content-addressed assets.
import { createHash } from 'node:crypto'
import fs from 'node:fs'

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** First 8 hex digits of the SHA-256: the content hash in emitted file names. */
export const hash8 = (buf) => sha256(buf).slice(0, 8)

/**
 * Checks a file against the bytes and SHA-256 the lock file pins. Returns the file's bytes, or
 * throws with both values so a mismatch is never silently accepted.
 */
export function readVerified(file, { bytes, sha256: want }, label = file) {
  if (!fs.existsSync(file)) throw new Error(`${label}: missing (${file}). Run npm run data:fetch.`)
  const buf = fs.readFileSync(file)
  const got = sha256(buf)
  if (buf.length !== bytes || got !== want) {
    throw new Error(
      `${label}: checksum mismatch — expected ${bytes} B sha256 ${want}, got ${buf.length} B sha256 ${got}`,
    )
  }
  return buf
}

/** Whether a file already matches its pin (used to reuse the download cache). */
export function matchesPin(file, { bytes, sha256: want }) {
  try {
    const stat = fs.statSync(file)
    if (stat.size !== bytes) return false
    return sha256(fs.readFileSync(file)) === want
  } catch {
    return false
  }
}
