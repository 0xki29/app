/**
 * How the reference character is typeset in the box. Shared by the on-screen reference layer and
 * the scorer's glyph raster so the two always line up.
 */

/** Font size as a fraction of the box width. */
export const REFERENCE_FONT_SCALE = 0.82

// Kai (楷) glyphs look like handwriting; system fallbacks until a licensed Kai font is bundled.
const HANS =
  "'KaiTi', 'STKaiti', 'Kaiti SC', 'Kaiti TC', 'BiauKai', 'DFKai-SB', 'Noto Serif CJK SC', " +
  "'Source Han Serif SC', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', serif"
const HANT =
  "'Kaiti TC', 'BiauKai', 'DFKai-SB', 'KaiTi', 'STKaiti', 'Noto Serif CJK TC', 'Source Han Serif TC', " +
  "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', serif"

export function referenceFontFamily(lang: string): string {
  return lang === 'zh-Hant' ? HANT : HANS
}
