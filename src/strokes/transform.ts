import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import type { Vec } from '../handwriting/scoring/types'

/**
 * The single mapping from dataset coordinates to the character box. Everything that places stroke
 * data — the on-screen glyph, the stroke animation and the scorer's reference raster — goes through
 * here, so what the learner sees is exactly what they are scored against.
 *
 * Dataset (Make Me a Hanzi): a 1024-unit em square, y pointing up, with the top of the em square at
 * y = 900 (the bottom at y = −124). Box: normalized 0..1, y pointing down, like user ink.
 * The em square is drawn at REFERENCE_FONT_SCALE of the box, centered — the same size the font
 * reference used, so switching a character to stroke data does not change its on-screen size.
 */
export const SOURCE_EM = 1024
export const SOURCE_TOP = 900

const SCALE = REFERENCE_FONT_SCALE / SOURCE_EM
const OFFSET = (1 - REFERENCE_FONT_SCALE) / 2

export function sourceToBox(x: number, y: number): Vec {
  return { x: OFFSET + x * SCALE, y: OFFSET + (SOURCE_TOP - y) * SCALE }
}

/** Box units of the SVG layers (`viewBox="0 0 100 100"`, like the practice grid). */
export const SVG_BOX = 100

/** SVG viewBox for a layer that covers the whole box. */
export const SVG_VIEWBOX = `0 0 ${SVG_BOX} ${SVG_BOX}`

/**
 * `transform` for a `<g>` inside an SVG with SVG_VIEWBOX: content inside it is written in dataset
 * coordinates (outlines, medians, stroke widths) and lands exactly where sourceToBox puts it.
 */
export const SOURCE_TO_SVG_TRANSFORM = (() => {
  const s = SCALE * SVG_BOX
  const o = OFFSET * SVG_BOX
  return `matrix(${s} 0 0 ${-s} ${o} ${o + SOURCE_TOP * s})`
})()
