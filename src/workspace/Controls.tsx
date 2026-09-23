import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { useEngineState } from '../handwriting/useEngineState'
import { useCommitCounter } from '../debug/renderStats'
import type { StrokeAnimator } from '../strokes/StrokeAnimator'
import { StrokeControls } from './StrokeControls'
import type { Mode } from './WorkspaceScreen'

interface Props {
  engine: HandwritingEngine
  mode: Mode
  scoring: boolean
  onPrimary: () => void
  animator: StrokeAnimator
  /** The character has stroke data: observe shows the stroke-order controls. */
  strokeGuide: boolean
}

/**
 * Writing-phase controls. The only component subscribed to per-stroke engine state
 * (canUndo / strokeCount), so a committed stroke re-renders this bar — not the workspace or canvas.
 * In observe, the stroke-order controls take the (otherwise hidden) undo/clear row's place.
 */
export function Controls({ engine, mode, scoring, onPrimary, animator, strokeGuide }: Props) {
  useCommitCounter('Controls')
  const { canUndo, strokeCount } = useEngineState(engine)
  const observe = mode === 'observe'

  return (
    <>
      {observe && strokeGuide ? (
        <StrokeControls animator={animator} />
      ) : (
        <div className="controls" data-hidden={observe || undefined}>
          <button type="button" className="btn" onClick={() => engine.undo()} disabled={!canUndo || scoring}>
            <span aria-hidden="true">↶</span> Hoàn tác
          </button>
          <button type="button" className="btn" onClick={() => engine.clear()} disabled={strokeCount === 0 || scoring}>
            <span aria-hidden="true">✕</span> Xóa
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary btn--wide"
        onClick={onPrimary}
        disabled={!observe && (strokeCount === 0 || scoring)}
      >
        {observe ? 'Tô theo chữ mẫu →' : scoring ? 'Đang chấm…' : 'Chấm điểm'}
      </button>
    </>
  )
}
