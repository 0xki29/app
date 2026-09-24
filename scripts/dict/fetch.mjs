// npm run data:fetch — downloads and verifies the dictionary build's inputs (see lib/download.mjs).
import process from 'node:process'
import console from 'node:console'
import { fetchSources, MB } from './lib/download.mjs'

const t0 = Date.now()
console.log('Dictionary sources (scripts/dict/sources.lock.json):')
try {
  const { downloaded } = await fetchSources()
  const took = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`All inputs verified${downloaded ? `; downloaded ${MB(downloaded)}` : ''} in ${took} s.`)
} catch (err) {
  console.error(`\ndata:fetch failed: ${err.message}`)
  process.exitCode = 1
}
