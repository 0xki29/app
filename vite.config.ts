import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The bundled stroke data (src/data/strokes) is under the Arphic Public License, which asks that
 * copies carry the license: every build ships it, with the data's notice, under licenses/.
 */
function strokeDataLicense(): Plugin {
  const files = [
    ['ARPHICPL.TXT', 'licenses/ARPHICPL.TXT'],
    ['README.md', 'licenses/stroke-data.md'],
  ] as const
  return {
    name: 'stroke-data-license',
    apply: 'build',
    generateBundle() {
      for (const [from, fileName] of files) {
        const source = readFileSync(new URL(`./src/data/strokes/${from}`, import.meta.url))
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

export default defineConfig({
  // Relative asset URLs: the build works at any sub-path (GitHub Pages serves /<repo>/).
  base: './',
  plugins: [react(), strokeDataLicense()],
  // The bundled dependencies' license notices (React, scheduler, perfect-freehand: MIT), which the
  // minified bundle does not keep, next to the stroke data's.
  build: { license: { fileName: 'licenses/third-party.md' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
