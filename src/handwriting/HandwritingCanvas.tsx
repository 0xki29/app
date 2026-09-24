import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { StrokeAnimator } from '../strokes/StrokeAnimator'
import type { StrokeCheck } from '../strokes/strokeCheck'
import type { StrokeStatus } from '../strokes/strokeData'
import { StrokeNumbers } from '../strokes/StrokeNumbers'
import { StrokeOrderView } from '../strokes/StrokeOrderView'
import type { StrokeData } from '../strokes/types'
import { boxLabel } from '../workspace/promptText'
import type { HandwritingEngine } from './HandwritingEngine'
import { REFERENCE_FONT_SCALE, referenceFontFamily } from './referenceFont'

/**
 * observe — reference shown solid, for looking (input is disabled by the caller); with stroke data
 *           it writes itself stroke by stroke
 * trace   — faint reference under the ink; with stroke data, numbered badges give the stroke order
 * hidden  — no reference (recall)
 * reveal  — translucent reference fading in on top of the ink, for self-assessment (font glyph)
 * review  — recall after scoring, with stroke data: the faint reference under the ink, like trace,
 *           with the stroke-by-stroke marks
 */
export type ReferenceMode = 'observe' | 'trace' | 'hidden' | 'reveal' | 'review'

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
   * `null`: none — the font glyph is shown, unless it is still loading (strokeStatus).
   */
  strokeData: StrokeData | null
  /**
   * Where the stroke data is (useStrokeData). While 'loading' the box shows a spinner instead of a
   * reference — not the font glyph, which the stroke glyph would replace a moment later. Default:
   * 'ready' with data, else 'none'.
   */
  strokeStatus?: StrokeStatus
  /** Plays the stroke order in observe mode. */
  animator?: StrokeAnimator | null
  /** After scoring: the stroke-by-stroke verdicts, shown on the stroke-number badges. */
  review?: StrokeCheck | null
}

/**
 * DOM shell for the engine. Mounts once per engine; re-renders only when the character, reference
 * mode or feedback state changes (or the canvas turns out to be unavailable). Drawing happens
 * entirely inside the engine.
 */
export const HandwritingCanvas = memo(function HandwritingCanvas({
  engine,
  char,
  lang,
  referenceMode,
  pulse,
  fading,
  strokeData,
  strokeStatus,
  animator,
  review,
}: Props) {
  useCommitCounter('Canvas')
  const boxRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const tailRef = useRef<HTMLCanvasElement>(null)
  // Only this flag of the engine state: a committed stroke must not re-render the canvas.
  const canvasError = useSyncExternalStore(
    engine.subscribe,
    useCallback(() => engine.getSnapshot().canvasError, [engine]),
  )

  useEffect(() => {
    const box = boxRef.current
    const staticCanvas = staticRef.current
    const liveCanvas = liveRef.current
    const tailCanvas = tailRef.current
    if (!box || !staticCanvas || !liveCanvas || !tailCanvas) return
    return engine.attach({ box, staticCanvas, liveCanvas, tailCanvas })
  }, [engine])

  const loading = !strokeData && strokeStatus === 'loading'
  const refStyle: CSSProperties = {
    fontFamily: referenceFontFamily(lang),
    fontSize: `${REFERENCE_FONT_SCALE * 100}cqi`,
  }
  // Recall review: the reference is drawn over the learner's character, at the size and place they
  // wrote it — the same alignment the stroke verdicts were judged with. Null (Trace, or a Recall
  // attempt too small to align on): in place.
  const shift = referenceMode === 'review' ? (review?.referenceToInk ?? null) : null
  const underStyle = useMemo<CSSProperties | undefined>(
    () =>
      shift
        ? {
            transformOrigin: '0 0',
            transform: `translate(${shift.x * 100}%, ${shift.y * 100}%) scale(${shift.scale})`,
          }
        : undefined,
    [shift],
  )

  return (
    <div
      ref={boxRef}
      className="hw-box"
      data-ref={referenceMode}
      data-fading={fading || undefined}
      aria-busy={loading || undefined}
      // An img's content is not read out, so the notice below would be hidden from screen readers.
      role={canvasError ? undefined : 'img'}
      aria-label={canvasError ? undefined : boxLabel(char, referenceMode === 'hidden')}
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
          style={underStyle}
        />
      ) : loading ? null : (
        <div className="hw-ref hw-ref--under" lang={lang} style={refStyle} aria-hidden="true">
          {char}
        </div>
      )}
      {/* Under the ink while writing, like the reference; lifted above it in review (styles.css). */}
      {strokeData && (referenceMode === 'trace' || referenceMode === 'review') && (
        <StrokeNumbers key={`nums-${char}`} data={strokeData} engine={engine} review={review} />
      )}
      <canvas ref={staticRef} className="hw-layer" />
      <canvas ref={liveRef} className="hw-layer" />
      <canvas ref={tailRef} className="hw-layer" />
      {strokeData ? (
        <StrokeOrderView key={`over-${char}`} className="hw-ref hw-ref--over" data={strokeData} variant="static" />
      ) : loading ? null : (
        <div className="hw-ref hw-ref--over" lang={lang} style={refStyle} aria-hidden="true">
          {char}
        </div>
      )}
      {loading && referenceMode !== 'hidden' && (
        <div className="hw-loading" aria-hidden="true">
          <span className="spinner" />
        </div>
      )}
      {pulse && <div key={pulse.key} className="hw-pulse" style={{ color: pulse.color }} aria-hidden="true" />}
      {canvasError && <CanvasUnavailable />}
    </div>
  )
})

/**
 * The engine got no 2D canvas (iOS refuses new canvases once canvas memory runs out): nothing can
 * be drawn, so say why and what helps, in the box itself.
 */
function CanvasUnavailable() {
  return (
    <div className="hw-error" role="alert">
      <p className="hw-error__title">Không vẽ được trong ô viết</p>
      <p className="hw-error__text">Trình duyệt không cấp bộ nhớ đồ hoạ. Hãy đóng bớt tab hoặc ứng dụng khác, rồi tải lại trang.</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>
        Tải lại
      </button>
    </div>
  )
}

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
