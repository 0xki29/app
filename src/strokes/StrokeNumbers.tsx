import { memo } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { REFERENCE_FONT_SCALE } from '../handwriting/referenceFont'
import { useEngineState } from '../handwriting/useEngineState'
import type { StrokeCheck } from './strokeCheck'
import { LABEL_RADIUS, strokeLabels } from './strokeLabels'
import { SOURCE_EM, SOURCE_TO_SVG_TRANSFORM, SVG_BOX, SVG_VIEWBOX, sourceToBox } from './transform'
import type { StrokeData } from './types'

interface Props {
  data: StrokeData
  engine: HandwritingEngine
  /** After scoring: each badge shows how the reference stroke with that number went. */
  review?: StrokeCheck | null
}

/** Badge radius in SVG box units. */
const RADIUS = (LABEL_RADIUS * REFERENCE_FONT_SCALE * SVG_BOX) / SOURCE_EM

type BadgeState = 'todo' | 'next' | 'done' | 'good' | 'off' | 'wrong' | 'missing'

/**
 * Stroke numbers: a small badge just before where each stroke starts (strokeLabels.ts).
 *
 * While writing (Trace), the next stroke to write — one past the strokes on the canvas — is
 * highlighted and the ones already written fade. It counts pen lifts, so a stroke written in two
 * pieces moves the highlight on by two; undo moves it back.
 *
 * In review (after scoring, Trace or Recall), badge k takes the verdict of reference stroke k —
 * whichever learner strokes the check matched to it (strokeCheck.ts) — and reference strokes the
 * learner never wrote are filled in the "wrong" color.
 *
 * Subscribes to the engine itself, so a committed stroke re-renders only this layer (like Controls),
 * never the canvas.
 */
export const StrokeNumbers = memo(function StrokeNumbers({ data, engine, review }: Props) {
  useCommitCounter('StrokeNumbers')
  const { strokeCount } = useEngineState(engine)
  const labels = strokeLabels(data)

  const stateOf = (i: number): BadgeState => {
    if (review) return review.reference[i]?.verdict ?? 'missing'
    return i < strokeCount ? 'done' : i === strokeCount ? 'next' : 'todo'
  }
  // Recall review draws the reference where the learner wrote it (see StrokeCheck.referenceToInk);
  // badges move with it but keep their size.
  const shift = review?.referenceToInk ?? null
  const place = (label: { x: number; y: number }) => {
    const p = sourceToBox(label.x, label.y)
    return shift ? { x: p.x * shift.scale + shift.x, y: p.y * shift.scale + shift.y } : p
  }

  return (
    <svg className="stroke-nums" data-review={review ? '' : undefined} viewBox={SVG_VIEWBOX} aria-hidden="true">
      {review && review.missing.length > 0 && (
        <g transform={shift ? `translate(${shift.x * SVG_BOX} ${shift.y * SVG_BOX}) scale(${shift.scale})` : undefined}>
          <g className="stroke-missing" transform={SOURCE_TO_SVG_TRANSFORM}>
            {review.missing.map((i) => (
              <path key={i} d={data.strokes[i]} />
            ))}
          </g>
        </g>
      )}
      {labels.map((label, i) => {
        const { x, y } = place(label)
        return (
          <g
            key={i}
            className="stroke-num"
            data-state={stateOf(i)}
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
