import { memo } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import { useEngineState } from '../handwriting/useEngineState'
import { LABEL_RADIUS, strokeLabels } from './strokeLabels'
import { SOURCE_EM, SVG_BOX, SVG_VIEWBOX, sourceToBox } from './transform'
import type { StrokeData } from './types'

interface Props {
  data: StrokeData
  engine: HandwritingEngine
}

/** Badge radius in SVG box units. */
const RADIUS = (LABEL_RADIUS * REFERENCE_FONT_SCALE * SVG_BOX) / SOURCE_EM

/**
 * Stroke numbers for Trace (Tô theo): a small badge just before where each stroke starts
 * (strokeLabels.ts). The next stroke to write — one past the strokes on the canvas — is highlighted,
 * the ones already written fade. It counts pen lifts, so a stroke written in two pieces moves the
 * highlight on by two; undo moves it back.
 *
 * Subscribes to the engine itself, so a committed stroke re-renders only this layer (like Controls),
 * never the canvas.
 */
export const StrokeNumbers = memo(function StrokeNumbers({ data, engine }: Props) {
  useCommitCounter('StrokeNumbers')
  const { strokeCount } = useEngineState(engine)
  const labels = strokeLabels(data)

  return (
    <svg className="stroke-nums" viewBox={SVG_VIEWBOX} aria-hidden="true">
      {labels.map((label, i) => {
        const { x, y } = sourceToBox(label.x, label.y)
        const state = i < strokeCount ? 'done' : i === strokeCount ? 'next' : 'todo'
        return (
          <g
            key={i}
            className="stroke-num"
            data-state={state}
            data-wide={i >= 9 || undefined}
            transform={`translate(${round2(x * SVG_BOX)} ${round2(y * SVG_BOX)})`}
          >
            <circle r={round2(RADIUS)} />
            {/* dy instead of dominant-baseline, which Safari ignores on <text>. */}
            <text dy="0.36em">{i + 1}</text>
          </g>
        )
      })}
    </svg>
  )
})

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
