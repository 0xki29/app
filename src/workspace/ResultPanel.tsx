import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { ScoreResult } from '../handwriting/scoring'
import type { Mode, Rating } from './attempt'
import { prefersReducedMotion } from './motion'
import { previewLines, resultDescription, type Headline } from './resultText'
import type { StrokeSummary } from './strokeFeedback'

const COUNT_UP_MS = 650

/**
 * How long the panel's buttons ignore input after they appear. The panel replaces the controls
 * under the learner's finger: the second tap of a double tap on "Chấm điểm" (or "Hiện mẫu") must
 * not rate or move on. The buttons fade in over the same time (styles.css) — or, with reduced
 * motion, stay dimmed until then — so what cannot be pressed yet does not look pressable either.
 */
export const ACTIVATION_GUARD_MS = 500

interface Props {
  result: ScoreResult
  /** Number, verdict and stroke tally (resultText.ts). */
  headline: Headline
  /** Stroke tallies (characters with stroke data). */
  summary: StrokeSummary | null
  /** Stroke issues, or the scorer's feedback without stroke data — the first two show, the rest expand. */
  lines: readonly string[]
  mode: Mode
  revealed: boolean
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
 * Score panel that takes the controls' place under the box. Mounted once per scoring (keyed by
 * the caller), so its entrance plays once per result, and it takes focus on its heading.
 *
 * Top to bottom: the headline (number, verdict, strokes right), what to fix, then the buttons —
 * at the bottom, where "Chấm điểm" was not (see Controls). Screen readers hear a result once, when
 * its heading takes focus: the heading names the region and is described by every line (all of
 * them, not only those shown). Nothing here is a live region, so the count-up is never read out.
 */
export function ResultPanel({ result, headline, summary, lines, mode, revealed, onRetry, onContinue, onReveal, onRate }: Props) {
  useCommitCounter('ResultPanel')
  const numRef = useRef<HTMLSpanElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const guardRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  /** The details toggle ("+N lỗi khác" / "Thu gọn"): re-rendered in another place on each press, so it is focused again. */
  const toggleTarget = useRef<HTMLElement | null>(null)
  const toggled = useRef(false)
  const detailsId = useId()
  const rateLabelId = useId()
  const titleId = useId()
  const descriptionId = useId()
  const target = headline.score

  // Count-up written straight to the DOM: no React re-render per frame.
  useLayoutEffect(() => {
    const el = numRef.current
    if (!el) return
    if (target === null) {
      el.textContent = '—'
      return
    }
    if (prefersReducedMotion()) {
      el.textContent = String(target)
      return
    }
    el.textContent = '0'
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      // The first frame's time can be earlier than `start` (it is the frame's start): never below 0.
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_UP_MS))
      const eased = 1 - (1 - t) ** 3
      el.textContent = String(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [target])

  // The button that was pressed is gone ("Chấm điểm", or "Hiện mẫu" when the rating replaces it):
  // focus moves to the result, not to <body>.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [revealed])

  // Opening or closing the details replaces the button that was pressed; keep the focus nearby.
  useEffect(() => {
    if (toggled.current) toggleTarget.current?.focus({ preventScroll: true })
  }, [expanded])

  const toggle = (open: boolean) => {
    toggled.current = true
    setExpanded(open)
  }

  // Activation guard, set before paint and again when the buttons change (reveal → rating).
  // `inert` blocks pointer and keyboard; data-guard adds pointer-events: none where inert is missing.
  useLayoutEffect(() => {
    const el = guardRef.current
    if (!el) return
    const release = () => {
      el.inert = false
      delete el.dataset.guard
    }
    el.inert = true
    el.dataset.guard = ''
    const id = window.setTimeout(release, ACTIVATION_GUARD_MS)
    return () => {
      window.clearTimeout(id)
      release()
    }
  }, [revealed])

  const scored = result.status === 'scored'
  const bars = scored ? BARS.filter((b) => result.breakdown[b.key] !== null) : []
  const { shown, more } = previewLines(lines)
  const canExpand = more > 0 || bars.length > 0
  const empty = summary ? 'Đúng thứ tự, đúng chiều.' : null
  const description = resultDescription(lines.length > 0 ? lines : empty ? [empty] : [])

  return (
    <section className="result" data-tone={headline.tone} aria-labelledby={titleId}>
      <div className="result__head">
        <div className="result__score" aria-hidden="true">
          <span ref={numRef} className="result__num" />
          <span className="result__caption">{headline.caption}</span>
        </div>
        <h2
          ref={headingRef}
          id={titleId}
          className="result__title"
          tabIndex={-1}
          aria-describedby={description ? descriptionId : undefined}
        >
          {headline.score !== null && (
            <span className="sr-only">
              {headline.score} {headline.caption}.{' '}
            </span>
          )}
          <span className="result__grade">{headline.label}</span>
          {summary && headline.strokes && (
            <span className="result__tally">
              <span className="result__count">{headline.strokes}</span>
              {summary.off > 0 && <Tally v="off">{summary.off} lệch</Tally>}
              {summary.wrong > 0 && <Tally v="wrong">{summary.wrong} sai</Tally>}
              {summary.missing > 0 && <Tally v="wrong">{summary.missing} thiếu</Tally>}
              {summary.extra > 0 && <Tally v="wrong">{summary.extra} thừa</Tally>}
            </span>
          )}
        </h2>
        {/* Read as the heading's description only (hidden: the visible lines are below). */}
        <span id={descriptionId} hidden>
          {description}
        </span>
      </div>

      <div ref={guardRef} className="result__body">
        <div className="result__details">
          {expanded ? (
            <div id={detailsId} className="result__more">
              {/* Where "Chi tiết" was, and kept in view while the list scrolls. */}
              <button
                ref={(el) => void (toggleTarget.current = el)}
                type="button"
                className="linkbtn result__collapse"
                aria-expanded="true"
                aria-controls={detailsId}
                onClick={() => toggle(false)}
              >
                Thu gọn
              </button>
              {lines.length > 0 && (
                <ul className="result__list">
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {bars.length > 0 && (
                <ul className="result__bars" aria-label="Điểm thành phần">
                  {bars.map((b, i) => (
                    <li key={b.key} style={{ '--v': result.breakdown[b.key]! / 100, '--i': i } as CSSProperties}>
                      <span>{b.label}</span>
                      <span className="bar" role="img" aria-label={`${result.breakdown[b.key]} trên 100`}>
                        <span className="bar__fill" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="result__issues">
              {shown.length > 0 ? shown.join(' · ') : empty}
              {canExpand && (
                <>
                  {' '}
                  <button
                    ref={(el) => void (toggleTarget.current = el)}
                    type="button"
                    className="linkbtn"
                    aria-expanded="false"
                    onClick={() => toggle(true)}
                  >
                    {more > 0 ? `+${more} lỗi khác` : 'Chi tiết'}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        {revealed ? (
          <div className="result__rate" role="group" aria-labelledby={rateLabelId}>
            {/* The group's visible label, outside any clamp: it must always show. */}
            <span id={rateLabelId} className="result__rate-label">
              Tự đánh giá
            </span>
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
      </div>
    </section>
  )
}

/** One count after the stroke headline ("· 1 sai"), in its verdict's color; the line may break before it. */
function Tally({ v, children }: { v: 'off' | 'wrong'; children: ReactNode }) {
  return (
    <>
      {' '}
      <span className="tally" data-v={v}>
        <span className="tally__sep" aria-hidden="true">
          ·{' '}
        </span>
        {children}
      </span>
    </>
  )
}
