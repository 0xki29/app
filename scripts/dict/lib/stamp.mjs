// What the last data build was made from, so `npm run data:ensure` (run by test:e2e) can skip a
// 20 s rebuild when nothing it reads has changed. The stamp lives in .cache/ (gitignored), never
// in public/, which would ship it.
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from './hash.mjs'
import { DATA_DIR, DICT_OUT, LICENSES_OUT, LOCK_FILE, PUBLIC_DIR, ROOT } from './paths.mjs'

// Next to the download cache, not in it: CI caches .cache/dict-src/ by the lock's hash.
const STAMP_FILE = path.join(ROOT, '.cache/data-build.json')

/** Every file the build's output depends on besides the pinned downloads (which the lock names). */
function inputFiles() {
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
      : []
  const scripts = path.join(ROOT, 'scripts/dict')
  return [
    LOCK_FILE,
    path.join(scripts, 'build.mjs'),
    ...walk(path.join(scripts, 'lib')),
    ...['overrides', 'golden', 'licenses', 'sources'].flatMap((d) => walk(path.join(DATA_DIR, d))),
  ].sort()
}

/** One hash over the inputs' paths and contents. */
export function inputsHash() {
  const h = []
  for (const f of inputFiles()) h.push(`${path.relative(ROOT, f).replaceAll('\\', '/')} ${sha256(fs.readFileSync(f))}`)
  return sha256(Buffer.from(h.join('\n')))
}

/** Written by a successful `data:build`. */
export function writeStamp(dataVersion) {
  fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true })
  fs.writeFileSync(STAMP_FILE, `${JSON.stringify({ inputs: inputsHash(), dataVersion }, null, 1)}\n`)
}

/**
 * Null when public/ holds a complete build of the current inputs; else why not (a rebuild is due).
 */
export function staleReason() {
  let stamp
  try {
    stamp = JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'))
  } catch {
    return 'no record of an earlier build'
  }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(DICT_OUT, 'manifest.json'), 'utf8'))
  } catch {
    return 'public/dict/v1/manifest.json is missing'
  }
  if (manifest.dataVersion !== stamp.dataVersion) return 'public/ holds another data version'
  const expected = [
    ...manifest.shards.map((s) => path.join(DICT_OUT, s.file)),
    path.join(PUBLIC_DIR, manifest.strokes.available),
    path.join(LICENSES_OUT, 'THIRD_PARTY_NOTICES.md'),
  ]
  const missing = expected.find((f) => !fs.existsSync(f))
  if (missing) return `${path.relative(ROOT, missing)} is missing`
  if (stamp.inputs !== inputsHash()) return 'the inputs changed (lock, overrides or build scripts)'
  return null
}
