// Where the data pipeline reads and writes. Every path is absolute and derived from this file's
// location, so the scripts behave the same from any working directory.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const LOCK_FILE = path.join(ROOT, 'scripts/dict/sources.lock.json')
/** Downloaded inputs (gitignored; CI caches it keyed on the lock file's hash). */
export const CACHE_DIR = path.join(ROOT, '.cache/dict-src')
export const DATA_DIR = path.join(ROOT, 'data')
export const OVERRIDES_DIR = path.join(DATA_DIR, 'overrides')
export const GOLDEN_DIR = path.join(DATA_DIR, 'golden')
export const LICENSE_TEXTS_DIR = path.join(DATA_DIR, 'licenses')
export const REPORT_FILE = path.join(DATA_DIR, 'build-report.json')

/** Generated, gitignored; Vite copies public/ into dist/ as is. */
export const PUBLIC_DIR = path.join(ROOT, 'public')
export const DICT_OUT = path.join(PUBLIC_DIR, 'dict/v1')
export const STROKES_VERSION = 'v2.0.1'
export const STROKES_OUT = path.join(PUBLIC_DIR, 'strokes', STROKES_VERSION)
export const LICENSES_OUT = path.join(PUBLIC_DIR, 'licenses')

export const NODE_MODULES = path.join(ROOT, 'node_modules')

/** Resolves a lock-file location: `npm:<package>/<path>`, a repo-relative path, or a cache file name. */
export function resolveLocal(spec) {
  if (spec.startsWith('npm:')) return path.join(NODE_MODULES, spec.slice(4))
  if (spec.startsWith('cache:')) return path.join(CACHE_DIR, spec.slice(6))
  return path.join(ROOT, spec)
}
