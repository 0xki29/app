// Downloads the pinned inputs of the dictionary build into .cache/dict-src/ (gitignored; CI caches
// it), checks every file's bytes and SHA-256 against sources.lock.json and aborts on any mismatch.
// Files already in the cache with the right checksum are reused, so a second run downloads
// nothing. A download that is an archive (the wordfreq wheel) is checked, then only the member the
// build needs is kept. Vendored and npm-installed inputs are verified in place.
import fs from 'node:fs'
import path from 'node:path'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { setTimeout as sleep } from 'node:timers/promises'
import { unzipSync } from 'fflate'
import { matchesPin, sha256 } from './hash.mjs'
import { checkNpmSource, loadLock, localPathOf, readPinned } from './lock.mjs'
import { CACHE_DIR } from './paths.mjs'

export const MB = (n) => `${(n / 1048576).toFixed(1)} MB`

/** GET with the build's generic User-Agent (no personal data), a timeout and retries. */
async function download(url, userAgent, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await globalThis.fetch(url, {
        headers: { 'User-Agent': userAgent },
        redirect: 'follow',
        signal: globalThis.AbortSignal.timeout(300_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (i >= attempts) throw new Error(`${url}: ${err.message}`, { cause: err })
      const wait = 1000 * 2 ** (i - 1)
      console.warn(`  ${url}: ${err.message} — retrying in ${wait / 1000} s`)
      await sleep(wait)
    }
  }
}

function checkBytes(buf, { bytes, sha256: want }, label) {
  const got = sha256(buf)
  if (buf.length !== bytes || got !== want) {
    throw new Error(`${label}: checksum mismatch — expected ${bytes} B sha256 ${want}, got ${buf.length} B sha256 ${got}`)
  }
}

/** Writes via a temporary file, so an interrupted run never leaves a partial file behind. */
function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.part`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file)
}

export async function fetchSources({ log = console.log } = {}) {
  const lock = loadLock()
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  let downloaded = 0
  for (const source of lock.sources) {
    if (source.npm) checkNpmSource(source)
    for (const f of source.files) {
      const label = `${source.id}/${f.role}`
      if (f.local || f.npmDir) continue // curated files (no pin); the stroke tree is checked by the build
      if (!f.url) {
        readPinned(f, label) // vendored or npm file: verified in place
        log(`  ok      ${label}`)
        continue
      }
      const dest = localPathOf(f)
      if (matchesPin(dest, f.extract ?? f)) {
        log(`  cached  ${label}`)
        continue
      }
      log(`  get     ${label} ← ${f.url}`)
      const buf = await download(f.url, lock.userAgent)
      checkBytes(buf, f, label)
      downloaded += buf.length
      if (f.extract) {
        const files = unzipSync(new Uint8Array(buf), { filter: (m) => m.name === f.extract.member })
        const member = files[f.extract.member]
        if (!member) throw new Error(`${label}: ${f.extract.member} not in the archive`)
        const out = Buffer.from(member)
        checkBytes(out, f.extract, `${label} (${f.extract.member})`)
        writeAtomic(dest, out)
      } else writeAtomic(dest, buf)
      log(`  ok      ${label} (${MB(buf.length)})`)
    }
  }
  return { downloaded }
}
