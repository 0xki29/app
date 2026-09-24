import { useLayoutEffect, useRef } from 'react'
import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { useEngineState } from '../handwriting/useEngineState'
import { useCommitCounter } from '../debug/renderStats'
import type { StrokeAnimator } from '../strokes/StrokeAnimator'
import type { StrokeStatus } from '../strokes/strokeData'
import type { Mode } from './attempt'
import { StrokeControls } from './StrokeControls'

interface Props {
  engine: HandwritingEngine
  mode: Mode
  scoring: boolean
  onPrimary: () => void
  /**
   * Until then (performance.now()) the primary button ignores taps — the caller checks — and looks
   * it: the rest of a double tap on the button it replaced.
   */
  primaryGuardUntil: number
  animator: StrokeAnimator
  /**
   * The character's stroke data. Observe shows the stroke-order controls while it loads (disabled
   * until it is in) and once it is there; in their place, why there is no animation ('none') or a
   * retry ('error').
   */
  strokeStatus: StrokeStatus
  onRetryStrokes: () => void
}

/**
 * Writing-phase controls. The only component subscribed to per-stroke engine state
 * (canUndo / strokeCount), so a committed stroke re-renders this bar — not the workspace or canvas.
 * In observe, the stroke-order controls take the (otherwise hidden) undo/clear row's place.
 *
 * While writing, "Chấm điểm" sits above Undo/Clear, not at the bottom: the result panel that
 * replaces these controls puts its buttons at the bottom, so the second tap of a double tap on
 * "Chấm điểm" lands on the result's text — never on "Tiếp tục" or a rating.
 */
export function Controls({ engine, mode, scoring, onPrimary, primaryGuardUntil, animator, strokeStatus, onRetryStrokes }: Props) {
  useCommitCounter('Controls')
  const { canUndo, strokeCount } = useEngineState(engine)
  const primaryRef = useRef<HTMLButtonElement>(null)

  // While the guard holds, the primary button is dimmed (data-guard), so what ignores a tap does not
  // look ready for one — with or without motion.
  useLayoutEffect(() => {
    const el = primaryRef.current
    const left = primaryGuardUntil - performance.now()
    if (!el || left <= 0) return
    el.dataset.guard = ''
    const id = window.setTimeout(() => delete el.dataset.guard, left)
    return () => {
      window.clearTimeout(id)
      delete el.dataset.guard
    }
  }, [primaryGuardUntil, mode])

  if (mode === 'observe') {
    return (
      <>
        {strokeStatus === 'ready' || strokeStatus === 'loading' ? (
          <StrokeControls animator={animator} />
        ) : (
          <StrokeDataNotice status={strokeStatus} onRetry={onRetryStrokes} />
        )}
        <button ref={primaryRef} type="button" className="btn btn--primary btn--wide" onClick={onPrimary}>
          Tô theo chữ mẫu →
        </button>
      </>
    )
  }

  return (
    <>
      <button
        ref={primaryRef}
        type="button"
        className="btn btn--primary btn--wide"
        onClick={onPrimary}
        disabled={strokeCount === 0 || scoring}
      >
        {scoring ? 'Đang chấm…' : 'Chấm điểm'}
      </button>
      <div className="controls">
        <button type="button" className="btn" onClick={() => engine.undo()} disabled={!canUndo || scoring}>
          <span aria-hidden="true">↶</span> Hoàn tác
        </button>
        <button type="button" className="btn" onClick={() => engine.clear()} disabled={strokeCount === 0 || scoring}>
          <span aria-hidden="true">✕</span> Xoá
        </button>
      </div>
    </>
  )
}

/** Observe without an animation: the character has no stroke data, or it could not be fetched. */
function StrokeDataNotice({ status, onRetry }: { status: 'none' | 'error'; onRetry: () => void }) {
  if (status === 'none') return <p className="controls controls--notice">Chưa có dữ liệu nét cho chữ này: chỉ xem được mặt chữ.</p>
  return (
    <div className="controls controls--notice" role="alert">
      <span>Không tải được thứ tự nét.</span>
      <button type="button" className="linkbtn" onClick={onRetry}>
        Thử lại
      </button>
    </div>
  )
}
