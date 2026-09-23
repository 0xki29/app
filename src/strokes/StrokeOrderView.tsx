import { memo, useEffect, useId, useMemo, useRef, type CSSProperties } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import { MEDIAN_STROKE_WIDTH, medianPath } from './medianPath'
import type { StrokeAnimator } from './StrokeAnimator'
import { SOURCE_TO_SVG_TRANSFORM, SVG_VIEWBOX } from './transform'
import type { StrokeData } from './types'

/**
 * animate — faint whole character, strokes drawn over it in order by a StrokeAnimator (Xem)
 * static  — every stroke filled, in the layer's current color (trace reference, recall reveal)
 */
export type StrokeViewVariant = 'animate' | 'static'

interface Props {
  data: StrokeData
  variant: StrokeViewVariant
  /** Drives the 'animate' variant; without one it shows only the faint character. */
  animator?: StrokeAnimator | null
  className?: string
  style?: CSSProperties
}

/**
 * The character from stroke data, as one SVG layer covering the box. Content is written in dataset
 * coordinates inside SOURCE_TO_SVG_TRANSFORM, so it lands exactly where the scorer's reference does.
 *
 * Animated strokes: a wide round-capped line along each median, clipped by that stroke's outline and
 * revealed by stroke-dashoffset. The animator writes `data-state` and the offset straight onto the
 * paths; React renders this once per character and variant, never per frame.
 */
export const StrokeOrderView = memo(function StrokeOrderView({ data, variant, animator, className, style }: Props) {
  useCommitCounter('StrokeView')
  const strokesRef = useRef<SVGGElement>(null)
  // useId output (e.g. «r1» or :r1:) is not safe inside url(#…).
  const clipId = `so${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const medians = useMemo(() => (variant === 'animate' ? data.medians.map((m) => medianPath(m)) : null), [data, variant])

  useEffect(() => {
    const group = strokesRef.current
    if (!animator || !medians || !group) return
    const paths = Array.from(group.children) as SVGPathElement[]
    if (paths.length !== medians.length) return
    return animator.attach(paths.map((el, i) => ({ el, length: medians[i].length, lead: medians[i].lead })))
  }, [animator, medians])

  const cls = ['hw-glyph', className].filter(Boolean).join(' ')

  if (!medians) {
    return (
      <svg className={cls} style={style} viewBox={SVG_VIEWBOX} aria-hidden="true">
        <g className="hw-glyph__fill" transform={SOURCE_TO_SVG_TRANSFORM}>
          {data.strokes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
    )
  }

  return (
    <svg className={cls} style={style} viewBox={SVG_VIEWBOX} aria-hidden="true">
      <g transform={SOURCE_TO_SVG_TRANSFORM}>
        <defs>
          {data.strokes.map((d, i) => (
            <clipPath key={i} id={`${clipId}-${i}`}>
              <path d={d} />
            </clipPath>
          ))}
        </defs>
        <g className="so-ghost">
          {data.strokes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {/* data-state and stroke-dashoffset belong to the animator; until it writes them, CSS keeps
            the strokes hidden. */}
        <g ref={strokesRef} className="so-strokes" strokeWidth={MEDIAN_STROKE_WIDTH}>
          {medians.map((m, i) => (
            <path
              key={i}
              className="so-stroke"
              d={m.d}
              clipPath={`url(#${clipId}-${i})`}
              strokeDasharray={m.length > 0 ? `${m.length} ${m.length}` : undefined}
            />
          ))}
        </g>
      </g>
    </svg>
  )
})
