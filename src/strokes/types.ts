/** A point in dataset (source) coordinates — see transform.ts. */
export type SourcePoint = readonly [number, number]

/**
 * Stroke-order data for one character, in the Make Me a Hanzi / hanzi-writer-data format.
 * Strokes are in standard writing order; each median runs from where the brush lands to where it lifts.
 */
export interface StrokeData {
  /** Stroke outlines as SVG path data (absolute M/L/Q/C/Z), source coordinates. */
  readonly strokes: readonly string[]
  /** Stroke centerlines, one per stroke, in writing direction, source coordinates. */
  readonly medians: readonly (readonly SourcePoint[])[]
  /** Indices of the strokes that form the radical, when known. */
  readonly radStrokes?: readonly number[]
}
