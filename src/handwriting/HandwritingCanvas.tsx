import { memo, useEffect, useRef, type CSSProperties } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { StrokeAnimator } from '../strokes/StrokeAnimator'
import { StrokeNumbers } from '../strokes/StrokeNumbers'
import { StrokeOrderView } from '../strokes/StrokeOrderView'
import type { StrokeData } from '../strokes/types'
import type { HandwritingEngine } from './HandwritingEngine'
import { REFERENCE_FONT_SCALE, referenceFontFamily } from './referenceFont'

/**
 * observe — reference shown solid, for looking (input is disabled by the caller); with stroke data
 *           it writes itself stroke by stroke
 * trace   — faint reference under the ink; with stroke data, numbered badges give the stroke order
 * hidden  — no reference (recall)
 * reveal  — translucent reference fading in on top of the ink, for self-assessment
 */
export type ReferenceMode = 'observe' | 'trace' | 'hidden' | 'reveal'

interface Props {
  engine: HandwritingEngine
  char: string
  lang: string
  referenceMode: ReferenceMode
  /** Changing `key` plays one soft ring around the box in `color` (score feedback). */
  pulse?: { key: number; color: string } | null
  /** Fade the ink out (before a rewrite clears it). */
  fading?: boolean
  /**
   * Stroke data for `char`: the reference is drawn from it (the same outlines the scorer uses).
   * `null`: none — the font glyph is shown.
   */
  strokeData: StrokeData | null
  /** Plays the stroke order in observe mode. */
  animator?: StrokeAnimator | null
}

/**
 * DOM shell for the engine. Mounts once per engine; re-renders only when the character, reference
 * mode or feedback state changes. Drawing happens entirely inside the engine.
 */
export const HandwritingCanvas = memo(function HandwritingCanvas({
  engine,
  char,
  lang,
  referenceMode,
  pulse,
  fading,
  strokeData,
  animator,
}: Props) {
  useCommitCounter('Canvas')
  const boxRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const tailRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const box = boxRef.current
    const staticCanvas = staticRef.current
    const liveCanvas = liveRef.current
    const tailCanvas = tailRef.current
    if (!box || !staticCanvas || !liveCanvas || !tailCanvas) return
    return engine.attach({ box, staticCanvas, liveCanvas, tailCanvas })
  }, [engine])

  const refStyle: CSSProperties = {
    fontFamily: referenceFontFamily(lang),
    fontSize: `${REFERENCE_FONT_SCALE * 100}cqi`,
  }

  return (
    <div
      ref={boxRef}
      className="hw-box"
      data-ref={referenceMode}
      data-fading={fading || undefined}
      role="img"
      aria-label={`Ô viết chữ ${char}`}
    >
      <Grid />
      {strokeData ? (
        // Keyed by character: fresh stroke elements carry no state from the previous character.
        <StrokeOrderView
          key={`under-${char}`}
          className="hw-ref hw-ref--under"
          data={strokeData}
          variant={referenceMode === 'observe' ? 'animate' : 'static'}
          animator={animator}
        />
      ) : (
        <div className="hw-ref hw-ref--under" lang={lang} style={refStyle} aria-hidden="true">
          {char}
        </div>
      )}
      {/* Under the ink, like the reference: the learner's strokes cover the badges, not the reverse. */}
      {strokeData && referenceMode === 'trace' && (
        <StrokeNumbers key={`nums-${char}`} data={strokeData} engine={engine} />
      )}
      <canvas ref={staticRef} className="hw-layer" />
      <canvas ref={liveRef} className="hw-layer" />
      <canvas ref={tailRef} className="hw-layer" />
      {strokeData ? (
        <StrokeOrderView key={`over-${char}`} className="hw-ref hw-ref--over" data={strokeData} variant="static" />
      ) : (
        <div className="hw-ref hw-ref--over" lang={lang} style={refStyle} aria-hidden="true">
          {char}
        </div>
      )}
      {pulse && <div key={pulse.key} className="hw-pulse" style={{ color: pulse.color }} aria-hidden="true" />}
    </div>
  )
})

/** 米字格 practice grid. */
function Grid() {
  return (
    <svg className="hw-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="50" y1="0" x2="50" y2="100" />
      <line x1="0" y1="50" x2="100" y2="50" />
      <line x1="0" y1="0" x2="100" y2="100" className="hw-grid__diag" />
      <line x1="100" y1="0" x2="0" y2="100" className="hw-grid__diag" />
    </svg>
  )
}
