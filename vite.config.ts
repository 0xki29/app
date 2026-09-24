import { existsSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The dictionary, stroke and license files are generated into public/ by `npm run data:build`
 * (gitignored) and copied into dist/ as they are. The data's licenses ask that their notices travel
 * with it, so a build that has the data but not its notices (public/licenses/, made by the same data
 * build) fails. A build without the data (a fresh clone, the unit-test job) only warns: the app then
 * says the dictionary is missing.
 */
function dataLicenses(): Plugin {
  const pub = (p: string) => new URL(`./public/${p}`, import.meta.url)
  return {
    name: 'data-licenses',
    apply: 'build',
    buildStart() {
      const manifest = pub('dict/v1/manifest.json')
      const hasDict = existsSync(manifest)
      const hasStrokes = existsSync(pub('strokes'))
      if (!hasDict && !hasStrokes) {
        this.warn('public/ has no dictionary or stroke data: this build ships without it. Run `npm run data:build` first.')
        return
      }
      const required = new Set(['licenses/THIRD_PARTY_NOTICES.md'])
      if (hasStrokes) required.add('licenses/ARPHICPL.TXT')
      if (hasDict) {
        const { sources } = JSON.parse(readFileSync(manifest, 'utf8')) as { sources: { licenseFiles?: string[] }[] }
        for (const s of sources) for (const f of s.licenseFiles ?? []) required.add(f)
      }
      const missing = [...required].filter((f) => !existsSync(pub(f)))
      if (missing.length) {
        this.error(`public/ has data without its license notices (${missing.join(', ')}). Run \`npm run data:build\`.`)
      }
    },
  }
}

export default defineConfig({
  // Relative asset URLs: the build works at any sub-path (GitHub Pages serves /<repo>/).
  base: './',
  plugins: [react(), dataLicenses()],
  // The bundled dependencies' license notices (React, scheduler, perfect-freehand: MIT), which the
  // minified bundle does not keep, next to the data's (public/licenses/).
  build: { license: { fileName: 'licenses/third-party.md' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
