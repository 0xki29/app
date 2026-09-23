import { REFERENCE_FONT_SCALE, referenceFontFamily } from '../referenceFont'
import { GRID_SIZE } from './config'
import type { GlyphMask, ReferenceCharacter, ReferenceProvider } from './types'

/**
 * Reference data from the device's CJK font: the glyph is typeset offscreen exactly like the
 * on-screen reference layer (same family, same size ratio, same vertical centering) and
 * thresholded into a mask. Not a screenshot; no stroke data. Varies with the fonts installed.
 */
export class GlyphReferenceProvider implements ReferenceProvider {
  private readonly cache = new Map<string, Promise<ReferenceCharacter>>()

  getReference(character: string, lang: string, strokeCount?: number): Promise<ReferenceCharacter> {
    const key = `${lang}|${character}|${strokeCount ?? ''}`
    let ref = this.cache.get(key)
    if (!ref) {
      ref = rasterizeGlyph(character, lang).then((glyph) => ({ character, strokeCount, glyph }))
      this.cache.set(key, ref)
    }
    return ref
  }
}

export async function rasterizeGlyph(character: string, lang: string, size = GRID_SIZE): Promise<GlyphMask | undefined> {
  const family = referenceFontFamily(lang)
  const font = `${size * REFERENCE_FONT_SCALE}px ${family}`
  try {
    await document.fonts.load(font, character)
  } catch {
    // System fonts need no loading; proceed with whatever the browser resolves.
  }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.lang = lang
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  // Same vertical placement as a `line-height: 1` line box centered in the box:
  // baseline = center + (ascent − descent) / 2.
  const m = ctx.measureText(character)
  const baseline = size / 2 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
  ctx.fillText(character, size / 2, baseline)

  const rgba = ctx.getImageData(0, 0, size, size).data
  const data = new Uint8Array(size * size)
  let ink = 0
  for (let i = 0; i < data.length; i++) {
    if (rgba[i * 4 + 3] >= 128) {
      data[i] = 1
      ink++
    }
  }
  // No CJK font → nothing drawn (or a tofu box); better no reference than a wrong one.
  return ink > 0 ? { size, data, source: 'font glyph (device font)' } : undefined
}
