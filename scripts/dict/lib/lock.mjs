// scripts/dict/sources.lock.json: what each source is, where its bytes come from and what they
// must hash to. fetch.mjs downloads the `url` files; build.mjs reads every file through `readPinned`,
// so nothing unverified reaches the output.
import fs from 'node:fs'
import path from 'node:path'
import { readVerified } from './hash.mjs'
import { CACHE_DIR, LOCK_FILE, NODE_MODULES, ROOT } from './paths.mjs'

export function loadLock(file = LOCK_FILE) {
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (lock.lockVersion !== 1) throw new Error(`${file}: unsupported lockVersion ${lock.lockVersion}`)
  return lock
}

export function sourceById(lock, id) {
  const s = lock.sources.find((x) => x.id === id)
  if (!s) throw new Error(`sources.lock.json: no source "${id}"`)
  return s
}

export function fileOf(lock, id, role) {
  const f = sourceById(lock, id).files.find((x) => x.role === role)
  if (!f) throw new Error(`sources.lock.json: source "${id}" has no file with role "${role}"`)
  return f
}

/** Where a lock-file entry lives on disk (for a download with `extract`, the extracted member). */
export function localPathOf(f) {
  if (f.vendored) return path.join(ROOT, f.vendored)
  if (f.local) return path.join(ROOT, f.local)
  if (f.npm) return path.join(NODE_MODULES, f.npm)
  if (f.npmDir) return path.join(NODE_MODULES, f.npmDir)
  if (f.extract) return path.join(CACHE_DIR, f.extract.cache)
  if (f.cache) return path.join(CACHE_DIR, f.cache)
  throw new Error(`sources.lock.json: file entry without a location: ${JSON.stringify(f)}`)
}

/** The pinned bytes of a lock-file entry, verified (throws on any mismatch). */
export function readPinned(f, label = f.role) {
  const pin = f.extract ?? f
  return readVerified(localPathOf(f), pin, label)
}

/**
 * An npm-installed source must be the locked version, with the integrity package-lock.json
 * recorded (npm checked the tarball against it at install).
 */
export function checkNpmSource(source) {
  const { package: name, version, integrity } = source.npm
  const pkg = JSON.parse(fs.readFileSync(path.join(NODE_MODULES, name, 'package.json'), 'utf8'))
  if (pkg.version !== version) {
    throw new Error(`${name}: node_modules has ${pkg.version}, the lock pins ${version}. Run npm ci.`)
  }
  const lockfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
  const entry = lockfile.packages?.[`node_modules/${name}`]
  if (!entry || entry.version !== version || entry.integrity !== integrity) {
    throw new Error(`${name}: package-lock.json does not pin ${version} with integrity ${integrity}`)
  }
}
