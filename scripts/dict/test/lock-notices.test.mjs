import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLock } from '../lib/lock.mjs'
import { manifestSources, noticeProblems, thirdPartyNotices } from '../lib/notices.mjs'
import { readCuratedTsv } from '../lib/overrides.mjs'
import { OVERRIDES_DIR, resolveLocal } from '../lib/paths.mjs'

const lock = loadLock()

describe('sources.lock.json', () => {
  it('pins every downloaded or vendored file by size and SHA-256', () => {
    for (const s of lock.sources) {
      for (const f of s.files) {
        if (f.local) continue
        if (f.npmDir) {
          expect(f.treeSha256).toMatch(/^[0-9a-f]{64}$/)
          continue
        }
        expect(f.sha256, `${s.id}/${f.role}`).toMatch(/^[0-9a-f]{64}$/)
        expect(f.bytes).toBeGreaterThan(0)
        if (f.url) expect(f.url).toMatch(/^https:\/\//)
        if (f.extract) expect(f.extract.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('pins downloads to immutable URLs (commits, versions), never a moving branch', () => {
    const urls = lock.sources.flatMap((s) => s.files.map((f) => f.url).filter(Boolean))
    for (const u of urls) expect(u).not.toMatch(/\/(main|master|latest)\//)
  })

  it('sends only a generic User-Agent', () => {
    expect(lock.userAgent).toBe('chinese-notebook-data-build (+https://github.com/0xki29/app)')
    expect(lock.userAgent).not.toMatch(/@/)
  })
})

describe('notices', () => {
  it('has a complete notice and a license text for every source', () => {
    expect(noticeProblems(lock)).toEqual([])
    for (const t of lock.licenseTexts) if (!t.from.startsWith('cache:')) expect(fs.existsSync(resolveLocal(t.from)), t.from).toBe(true)
  })

  it('names every source in THIRD_PARTY_NOTICES.md, with its attribution', () => {
    const md = thirdPartyNotices(lock, { dataVersion: 'test', rows: 1 })
    for (const s of lock.sources) {
      expect(md).toContain(`### ${s.name}`)
      expect(md).toContain(s.attribution)
    }
    expect(md).toContain('Paul Andrew Denisowski')
    expect(md).toContain('Phong Phan')
    expect(md).toContain('Robyn Speer')
    expect(md).toContain('SUBTLEX')
  })

  it('gives the manifest the fields the credits page reads', () => {
    for (const s of manifestSources(lock)) {
      for (const k of ['id', 'name', 'version', 'url', 'license', 'licenseUrl', 'attribution', 'notes']) expect(s[k], `${s.id}.${k}`).toBeTruthy()
      for (const f of s.licenseFiles) expect(f).toMatch(/^licenses\//)
    }
  })
})

describe('curated overrides', () => {
  it('parse, with a known status on every row', () => {
    for (const name of ['vi-gloss.tsv', 'hanviet-word.tsv', 'extra-entries.tsv', 'join-deny.tsv', 'not-proper-noun.tsv']) {
      const rows = readCuratedTsv(fs.readFileSync(path.join(OVERRIDES_DIR, name), 'utf8'), name)
      expect(rows.length, name).toBeGreaterThan(0)
      for (const r of rows) expect(r.key, `${name}: ${r.key}`).toMatch(/^[^|[\]]+\|[^|[\]]+\[[^\]]+\]$/)
    }
  })

  it('rejects an unknown status and an empty cell', () => {
    expect(() => readCuratedTsv('key\tvi\tsource\tstatus\nA|A[a1]\tx\ty\tdone\n')).toThrow(/status/)
    // an empty meaning would ship under the curated label
    expect(() => readCuratedTsv('key\tvi\tsource\tstatus\nA|A[a1]\t \ty\tai-draft\n', 'vi-gloss.tsv')).toThrow(/empty "vi"/)
  })

  it('keeps slang and vulgar senses labelled and after the plain ones', () => {
    const rows = readCuratedTsv(fs.readFileSync(path.join(OVERRIDES_DIR, 'vi-gloss.tsv'), 'utf8'))
    for (const r of rows) {
      const senses = r.vi.split('/').filter((s) => !s.startsWith('Lượng từ: '))
      const first = senses.findIndex((s) => /^\((tiếng lóng|thô tục)/.test(s))
      if (first < 0) continue
      expect(senses.slice(first).every((s) => /^\((tiếng lóng|thô tục)/.test(s)), r.key).toBe(true)
    }
  })
})
