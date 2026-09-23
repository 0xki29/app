import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import { GRADE_LABEL, type ScoreResult } from '../handwriting/scoring'
import type { StrokeCheck } from '../strokes/strokeCheck'
import { prefersReducedMotion } from './motion'
import { summarizeStrokes } from './strokeFeedback'
import type { Mode, Rating } from './WorkspaceScreen'

const COUNT_UP_MS = 650

interface Props {
  result: ScoreResult
  mode: Mode
  revealed: boolean
  /** Stroke-by-stroke verdicts (characters with stroke data): replace the generic feedback line. */
  strokes?: StrokeCheck | null
  onRetry: () => void
  onContinue: () => void
  onReveal: () => void
  onRate: (rating: Rating) => void
}

const BARS: readonly { key: 'shape' | 'position' | 'length' | 'strokeCount'; label: string }[] = [
  { key: 'shape', label: 'Hình dáng' },
  { key: 'position', label: 'Vị trí' },
  { key: 'length', label: 'Độ dài nét' },
  { key: 'strokeCount', label: 'Số nét' },
]

/**
 * Compact score panel that takes the controls' place under the box. Mounted once per scoring
 * (keyed by the caller), so its entrance animations play exactly once per result.
 */
export function ResultPanel({ result, mode, revealed, strokes, onRetry, onContinue, onReveal, onRate }: Props) {
  useCommitCounter('ResultPanel')
  const numRef = useRef<HTMLSpanElement>(null)
  const scored = result.status === 'scored'

  // Count-up written straight to the DOM: no React re-render per frame.
  useLayoutEffect(() => {
    const el = numRef.current
    if (!el) return
    if (!scored) {
      el.textContent = '—'
      return
    }
    const target = result.total
    if (prefersReducedMotion()) {
      el.textContent = String(target)
      return
    }
    el.textContent = '0'
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - (1 - t) ** 3
      el.textContent = String(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [result, scored])

  const bars = BARS.filter((b) => result.breakdown[b.key] !== null)
  const summary = strokes ? summarizeStrokes(strokes) : null

  return (
    <section
      className="result"
      data-grade={scored ? result.grade : 'none'}
      aria-live="polite"
      aria-label={scored ? `${result.total} điểm, ${GRADE_LABEL[result.grade]}` : result.feedback[0]}
    >
      <div className="result__head">
        <div className="result__score" title="Điểm phản hồi dựa trên hình dáng nét viết, không phải nhận dạng chữ.">
          <span ref={numRef} className="result__num" />
          <span className="result__grade">{scored ? GRADE_LABEL[result.grade] : 'Chưa chấm được'}</span>
          <span className="result__caption">điểm phản hồi</span>
        </div>
        {scored && (
          <ul className="result__bars">
            {bars.map((b, i) => (
              <li key={b.key} style={{ '--v': result.breakdown[b.key]! / 100, '--i': i } as CSSProperties}>
                <span>{b.label}</span>
                <span className="bar">
                  <span className="bar__fill" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary ? (
        <p className="result__feedback result__strokes">
          <span className="tally" data-v="good">
            {summary.good} đúng
          </span>
          {summary.off > 0 && (
            <span className="tally" data-v="off">
              {summary.off} lệch
            </span>
          )}
          {summary.wrong > 0 && (
            <span className="tally" data-v="wrong">
              {summary.wrong} sai
            </span>
          )}
          {summary.missing > 0 && (
            <span className="tally" data-v="wrong">
              {summary.missing} thiếu
            </span>
          )}
          <span className="result__issues">
            {summary.issues.length > 0 ? summary.issues.join(' · ') : 'Đúng thứ tự, đúng chiều.'}
          </span>
          {revealed && <span className="result__prompt">Tự đánh giá:</span>}
        </p>
      ) : (
        <p className="result__feedback">
          {revealed ? 'So sánh chữ của bạn với mẫu, rồi tự đánh giá:' : result.feedback.join(' ')}
        </p>
      )}

      {revealed ? (
        <div className="result__actions result__actions--rating">
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
      ) : (
        <div className="result__actions">
          <button type="button" className="btn" onClick={onRetry}>
            <span aria-hidden="true">↺</span> Viết lại
          </button>
          {mode === 'recall' ? (
            <button type="button" className="btn btn--primary" onClick={onReveal}>
              Hiện mẫu
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={onContinue}>
              Tiếp tục →
            </button>
          )}
        </div>
      )}
    </section>
  )
}
