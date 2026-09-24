// hanzi-writer-data's per-character stroke files, published byte for byte under code-point names
// (strokes/v2.0.1/<lowercase hex>.json). Renaming only: the content is the Arphic-licensed data
// unmodified, so no per-file change notice is needed (Arphic PL §2a applies to modified files).
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from './hash.mjs'

/** Lowercase hex code point: "学" → "5b66". */
export const hexOf = (ch) => ch.codePointAt(0).toString(16)

/** One entry per "<char>.json" in the package directory (package.json and the like excluded). */
export function listStrokeFiles(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const base = name.slice(0, -5)
    if ([...base].length !== 1) continue
    out.push({ char: base, name, hex: hexOf(base) })
  }
  return out.sort((a, b) => a.char.codePointAt(0) - b.char.codePointAt(0))
}

/**
 * One checksum over every stroke file (hex name and content hash per line), pinned in the lock
 * file: npm verified the package tarball at install; this ties the build to exactly those files.
 */
export function strokeTreeHash(dir, files) {
  const lines = files.map((f) => `${f.hex}\t${sha256(fs.readFileSync(path.join(dir, f.name)))}\n`)
  return sha256(lines.join(''))
}

/** Copies the files under their code-point names; returns the total bytes. */
export function copyStrokeFiles(dir, files, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  let bytes = 0
  for (const f of files) {
    const dest = path.join(outDir, `${f.hex}.json`)
    fs.copyFileSync(path.join(dir, f.name), dest)
    bytes += fs.statSync(dest).size
  }
  return bytes
}
