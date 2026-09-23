import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { useEngineState } from '../handwriting/useEngineState'
import { useCommitCounter } from '../debug/renderStats'
import type { Mode } from './WorkspaceScreen'

interface Props {
  engine: HandwritingEngine
  mode: Mode
  scoring: boolean
  onPrimary: () => void
}

/**
 * Writing-phase controls. The only component subscribed to per-stroke engine state
 * (canUndo / strokeCount), so a committed stroke re-renders this bar — not the workspace or canvas.
 */
export function Controls({ engine, mode, scoring, onPrimary }: Props) {
  useCommitCounter('Controls')
  const { canUndo, strokeCount } = useEngineState(engine)
  const observe = mode === 'observe'

  return (
    <>
      <div className="controls" data-hidden={observe || undefined}>
        <button type="button" className="btn" onClick={() => engine.undo()} disabled={!canUndo || scoring}>
          <span aria-hidden="true">↶</span> Hoàn tác
        </button>
        <button type="button" className="btn" onClick={() => engine.clear()} disabled={strokeCount === 0 || scoring}>
          <span aria-hidden="true">✕</span> Xóa
        </button>
      </div>
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
