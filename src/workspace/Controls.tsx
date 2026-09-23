import type { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { useEngineState } from '../handwriting/useEngineState'
import { useCommitCounter } from '../debug/renderStats'
import type { Mode, Rating } from './WorkspaceScreen'

interface Props {
  engine: HandwritingEngine
  mode: Mode
  revealed: boolean
  onPrimary: () => void
  onRate: (rating: Rating) => void
}

const PRIMARY_LABEL: Record<Mode, string> = {
  observe: 'Tô theo chữ mẫu →',
  trace: 'Viết từ trí nhớ →',
  recall: 'Hiện đáp án',
}

/**
 * The only component subscribed to per-stroke engine state (canUndo / strokeCount), so a
 * committed stroke re-renders this bar — not the workspace or the canvas.
 */
export function Controls({ engine, mode, revealed, onPrimary, onRate }: Props) {
  useCommitCounter('Controls')
  const { canUndo, strokeCount } = useEngineState(engine)

  if (mode === 'recall' && revealed) {
    return (
      <>
        <div className="controls controls--rating">
          <button type="button" className="btn btn--wrong" onClick={() => onRate('wrong')}>
            Sai
          </button>
          <button type="button" className="btn btn--close" onClick={() => onRate('close')}>
            Gần đúng
          </button>
          <button type="button" className="btn btn--correct" onClick={() => onRate('correct')}>
            Đúng
          </button>
        </div>
        <div className="primary primary--hint">Bạn viết có giống chữ mẫu không?</div>
      </>
    )
  }

  return (
    <>
      <div className="controls" data-hidden={mode === 'observe' || undefined}>
        <button type="button" className="btn" onClick={() => engine.undo()} disabled={!canUndo}>
          <span aria-hidden="true">↶</span> Hoàn tác
        </button>
        <button type="button" className="btn" onClick={() => engine.clear()} disabled={strokeCount === 0}>
          <span aria-hidden="true">✕</span> Xóa
        </button>
      </div>
      <div className="primary">
        <button type="button" className="btn btn--primary" onClick={onPrimary}>
          {PRIMARY_LABEL[mode]}
        </button>
      </div>
    </>
  )
}
