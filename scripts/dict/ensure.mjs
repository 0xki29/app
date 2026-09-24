// npm run data:ensure — runs data:build (fetch + build) unless public/ already holds a complete
// build of the current inputs (lib/stamp.mjs). `npm run test:e2e` runs it first: the e2e tests need
// the dictionary and the stroke files, and an unchanged build is not worth 20 s every time.
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { staleReason } from './lib/stamp.mjs'

const why = staleReason()
if (!why) {
  console.log('Dictionary data in public/ is up to date (npm run data:build rebuilds it anyway).')
} else {
  console.log(`Dictionary data needs a build: ${why}.`)
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const script of ['fetch.mjs', 'build.mjs']) {
    const r = spawnSync(process.execPath, [path.join(here, script)], { stdio: 'inherit' })
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
}
