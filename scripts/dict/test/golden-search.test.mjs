// The golden search queries (data/golden/search-queries.tsv) on the built dictionary: the app's own
// search index (src/dict/searchIndex.ts) over the shards in public/dict/v1/. A data change that
// breaks what a learner finds first fails `npm test` (CI runs it right after `npm run data:build`).
// Skipped when the data was never built: unit tests need no generated files.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../../src/dict/searchIndex.ts'
import { DICT_OUT, GOLDEN_DIR } from '../lib/paths.mjs'

const manifestFile = path.join(DICT_OUT, 'manifest.json')
const built = fs.existsSync(manifestFile)

const queries = fs
  .readFileSync(path.join(GOLDEN_DIR, 'search-queries.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
  .slice(1)
  .map((l) => {
    const [query, expected, what] = l.split('\t')
    return { query, expected, what }
  })

describe.skipIf(!built)('golden search queries on the built dictionary', () => {
  const index = built
    ? (() => {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
        return buildIndex(manifest.shards.map((s) => fs.readFileSync(path.join(DICT_OUT, s.file), 'utf8')))
      })()
    : null

  it('has at least 20 queries', () => {
    expect(queries.length).toBeGreaterThanOrEqual(20)
  })

  it.each(queries)('$query → $expected ($what)', ({ query, expected }) => {
    const top = index.search(query).hits[0]
    expect(top, `nothing found for ${query}`).toBeDefined()
    const e = index.entry(top.id)
    expect(expected.includes('[') ? e.key : e.simp).toBe(expected)
  })
}, 120_000)
