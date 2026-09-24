import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ErrorBoundary } from '../app/ErrorBoundary'
import { reportError } from '../app/errorReporting'
import { LiveRegion, type Announcement } from '../app/LiveRegion'
import { useViewportLock } from '../app/viewportLock'
import { langOf, scriptLabel, TEST_CHARS } from '../data/testChars'
import type { ScoreDebug } from '../debug/DebugHud'
import { useCommitCounter } from '../debug/renderStats'
import { HandwritingCanvas } from '../handwriting/HandwritingCanvas'
import { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { referenceProvider, scorer } from '../handwriting/scoring'
import { checkStrokes, type StrokeCheck } from '../strokes/strokeCheck'
import { StrokeAnimator } from '../strokes/StrokeAnimator'
import { useStrokeData } from '../strokes/useStrokeData'
import {
  acceptsInput,
  canScore,
  currentResult,
  INITIAL_PRACTICE,
  isRecallLocked,
  nextIndex,
  practiceReducer,
  referenceView,
  showsCharacter,
  type Mode,
  type PracticeAction,
  type Rating,
} from './attempt'
import { Controls } from './Controls'
import { prefersReducedMotion } from './motion'
import { recallInstruction } from './promptText'
import { ACTIVATION_GUARD_MS, ResultPanel } from './ResultPanel'
import { deriveHeadline, interruptionLines, resultLines, type Tone } from './resultText'
import { summarizeStrokes } from './strokeFeedback'

const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'observe', label: 'Xem' },
  { id: 'trace', label: 'Tô theo' },
  { id: 'recall', label: 'Nhớ lại' },
]

const RATING_LABEL: Record<Rating, string> = { correct: 'Đúng', close: 'Gần đúng', wrong: 'Sai' }

const TONE_COLOR: Record<Tone, string> = {
  correct: 'var(--correct)',
  close: 'var(--close)',
  wrong: 'var(--wrong)',
  none: 'var(--muted)',
}

/** Ink fade before a rewrite clears the box. */
const REWRITE_FADE_MS = 220

const params = new URLSearchParams(window.location.search)
const debugAvailable = import.meta.env.DEV || params.has('debug')

// The HUD is a developer tool: its code is fetched only when it is opened.
const DebugHud = lazy(() => import('../debug/DebugHud').then((m) => ({ default: m.DebugHud })))

/**
 * The writing workspace. The practice flow lives in a pure reducer (attempt.ts); this component
 * renders it and keeps the engine in step: a new attempt resets the box, the phase decides whether
 * it takes input, and scoring reports back only to the attempt that asked.
 */
export function WorkspaceScreen() {
  useCommitCounter('Workspace')
  useViewportLock()
  const [engine] = useState(() => new HandwritingEngine({ desynchronized: params.get('desync') === '1' }))
  const [animator] = useState(() => new StrokeAnimator())
  const [state, dispatch] = useReducer(practiceReducer, INITIAL_PRACTICE)
  /** A short message, shown as a toast and announced once through the live region. */
  const [toast, setToastMessage] = useState<Announcement | null>(null)
  const [hudOpen, setHudOpen] = useState(() => params.get('debug') === '1')
  const promptRef = useRef<HTMLHeadingElement>(null)
  /** Set by dock actions whose button goes away: the new attempt's prompt takes focus, not <body>. */
  const focusPrompt = useRef(false)
  /** Until then (performance.now()) the primary button ignores taps: the rest of a double tap on the button it replaced. */
  const [primaryGuardUntil, setPrimaryGuardUntil] = useState(0)
  /** The attempt async scoring may still report to. */
  const attemptRef = useRef(state.attemptId)

  const { index, mode, phase, attemptId, fading, peeked } = state
  const item = TEST_CHARS[index]
  const count = TEST_CHARS.length
  const strokeData = useStrokeData(item.char)
  const current = currentResult(state)
  const inputOn = acceptsInput(state)

  // Every attempt starts with a fresh box: no ink, history or verdict colors from the last one.
  // Before paint, so old ink never shows under the new attempt's controls. Focus goes to the new
  // prompt when a dock button asked for it, or when it was inside something the attempt removed
  // (the result panel) — Safari does not focus a tapped tab, so it would otherwise fall to <body>.
  useLayoutEffect(() => {
    const changed = attemptRef.current !== attemptId
    attemptRef.current = attemptId
    engine.reset()
    const lost = document.activeElement === null || document.activeElement === document.body
    if (focusPrompt.current || (changed && lost)) promptRef.current?.focus({ preventScroll: true })
    focusPrompt.current = false
  }, [engine, attemptId])

  useLayoutEffect(() => {
    engine.setInputEnabled(inputOn)
  }, [engine, inputOn])

  useEffect(() => {
    animator.setData(strokeData)
  }, [animator, strokeData])

  // Stroke order plays only in observe: from the first stroke whenever observe is entered or shows
  // a new character (unless the learner paused it; see StrokeAnimator.show). "Xem" tapped again
  // starts no new attempt (attempt.ts), so the learner keeps their place. Outside observe the view
  // is static and detached, so no frames run either way.
  useEffect(() => {
    if (mode === 'observe') animator.show()
    else animator.pause()
  }, [animator, mode, strokeData, attemptId])

  useEffect(() => {
    if (!fading) return
    const id = window.setTimeout(() => dispatch({ type: 'faded', attemptId }), REWRITE_FADE_MS)
    return () => window.clearTimeout(id)
  }, [fading, attemptId])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToastMessage(null), 1800)
    return () => window.clearTimeout(id)
  }, [toast])

  // A new id for every toast, so the same text is announced again.
  const setToast = (text: string) => setToastMessage((prev) => ({ id: (prev?.id ?? 0) + 1, text }))

  const go = useCallback((nextIndex: number, nextMode: Mode) => dispatch({ type: 'go', index: nextIndex, mode: nextMode }), [])

  /** A dock button that starts a new attempt: focus and the next tap are taken care of. */
  const moveOn = (action: PracticeAction) => {
    focusPrompt.current = true
    setPrimaryGuardUntil(performance.now() + ACTIVATION_GUARD_MS)
    dispatch(action)
  }

  const score = async () => {
    if (mode === 'observe' || !canScore(state)) return
    // Commit a stroke still being written (another finger may still be on the box), so the ink
    // scored is exactly the ink shown.
    engine.flushInput()
    const ink = engine.getInk()
    if (ink.strokes.length === 0) return
    const id = attemptId
    dispatch({ type: 'score' })
    const t0 = performance.now()
    try {
      const reference = await referenceProvider.getReference(item.char, langOf(item), item.strokeCount)
      const result = await scorer.score(ink, reference, mode)
      const check = strokeData && result.status === 'scored' ? checkStrokes(ink, strokeData, mode) : null
      if (attemptRef.current !== id) return
      // The learner's own strokes take the verdict colors — for this ink only (the revision).
      engine.setStrokeColors(check ? verdictColors(check) : null, ink.revision)
      const ends = ink.strokes.map((s) => s.end)
      dispatch({ type: 'scored', attemptId: id, attempt: { result, check, ends, ms: performance.now() - t0 } })
    } catch (err) {
      reportError('scoring', err, { char: item.char, mode })
      if (attemptRef.current !== id) return
      dispatch({ type: 'scoreFailed', attemptId: id })
      setToast('Chưa chấm được. Hãy thử lại.')
    }
  }

  const onPrimary = () => {
    if (performance.now() < primaryGuardUntil) return
    if (mode === 'observe') moveOn({ type: 'go', index, mode: 'trace' })
    else void score()
  }

  const onTab = (next: Mode) => {
    // Recall is locked once its answer is on screen (attempt.ts): say why nothing happens.
    if (next === 'recall' && isRecallLocked(state)) setToast('Đã hiện mẫu: hãy tự đánh giá')
    else go(index, next)
  }

  const rewrite = () => {
    focusPrompt.current = true
    dispatch({ type: 'rewrite', fade: !prefersReducedMotion() })
  }

  const onRate = (rating: Rating) => {
    console.log('[rating]', { char: item.char, rating, peeked, score: current?.attempt.result.total, ink: engine.getInk() })
    const next = nextIndex(index, count)
    setToast(`${item.char} → ${RATING_LABEL[rating]}${next.wrapped ? ' · quay lại chữ đầu' : ''}`)
    moveOn({ type: 'rate', index: next.index })
  }

  // What the result says, once per result (and again when a font-glyph recall is revealed).
  const view = useMemo(() => {
    if (!current) return null
    const { result, check, ends } = current.attempt
    const summary = check ? summarizeStrokes(check) : null
    const headline = deriveHeadline(result, summary)
    const lines = resultLines(result, summary, interruptionLines(ends, check), phase === 'revealed')
    return { seq: current.seq, result, check, summary, headline, lines }
  }, [current, phase])

  const pulse = useMemo(() => (view ? { key: view.seq, color: TONE_COLOR[view.headline.tone] } : null), [view])
  const hudScore = useMemo<ScoreDebug | null>(
    () => (state.last ? { result: state.last.attempt.result, ms: state.last.attempt.ms, seq: state.last.seq } : null),
    [state.last],
  )

  const script = scriptLabel(item)
  const showChar = showsCharacter(state)

  return (
    <div className="workspace" data-mode={mode}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Chữ trước"
          disabled={index === 0}
          onClick={() => go(index - 1, mode)}
        >
          ‹
        </button>
        <div className="modes" role="tablist" aria-label="Chế độ">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === mode}
              className="modes__tab"
              onClick={() => onTab(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Chữ sau"
          disabled={index === count - 1}
          onClick={() => go(index + 1, mode)}
        >
          ›
        </button>
      </header>

      <section className="prompt" aria-label="Chữ cần viết">
        <div className="prompt__main">
          <h1 ref={promptRef} className="prompt__pinyin" tabIndex={-1}>
            {item.pinyin}
            {showChar && <span className="prompt__hanviet"> · {item.hanViet}</span>}
          </h1>
          <p className="prompt__meaning">{item.meaningVi}</p>
          <p className="prompt__extra">
            {mode === 'recall' && !showChar ? (
              recallInstruction(item, peeked)
            ) : (
              <>
                {script}
                {/* The note is the first thing to go on very short screens (styles.css). */}
                {mode === 'observe' && item.note && (
                  <span className="prompt__note">
                    {script ? ' · ' : ''}
                    {item.note}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="prompt__meta">
          <span className="prompt__count">
            {index + 1} / {count}
          </span>
          {debugAvailable && (
            <button type="button" className="chip" aria-pressed={hudOpen} onClick={() => setHudOpen((v) => !v)}>
              HUD
            </button>
          )}
        </div>
      </section>

      <main className="stage">
        <HandwritingCanvas
          engine={engine}
          char={item.char}
          lang={langOf(item)}
          referenceMode={referenceView(state)}
          pulse={pulse}
          fading={fading}
          strokeData={strokeData}
          animator={animator}
          review={view?.check ?? null}
        />
      </main>

      <div className="dock">
        {view ? (
          <ResultPanel
            key={view.seq}
            result={view.result}
            headline={view.headline}
            summary={view.summary}
            lines={view.lines}
            mode={mode}
            revealed={phase === 'revealed'}
            onRetry={rewrite}
            onContinue={() => moveOn({ type: 'go', index, mode: 'recall' })}
            onReveal={() => dispatch({ type: 'reveal' })}
            onRate={onRate}
          />
        ) : (
          <Controls
            engine={engine}
            mode={mode}
            scoring={phase === 'scoring'}
            onPrimary={onPrimary}
            primaryGuardUntil={primaryGuardUntil}
            animator={animator}
            strokeGuide={strokeData !== null}
          />
        )}
      </div>

      {/* Results are read from their heading, which takes focus (ResultPanel); the one persistent
          live region carries the toasts, which nothing else conveys. */}
      <LiveRegion message={toast} />
      {toast && (
        <div className="toast" aria-hidden="true">
          {toast.text}
        </div>
      )}
      {hudOpen && (
        // A HUD that fails to load or render must not take the workspace down with it.
        <ErrorBoundary fallback={null} context="debug-hud">
          <Suspense fallback={null}>
            <DebugHud engine={engine} score={hudScore} onClose={() => setHudOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

/**
 * The canvas needs concrete colors: the verdict tokens, read from the stylesheet. A tap is no
 * stroke and keeps the ink color (the engine drops taps; this is for ink from elsewhere).
 */
function verdictColors(check: StrokeCheck): (string | null)[] {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(name).trim() || null
  const color = { good: token('--correct'), off: token('--close'), wrong: token('--wrong') }
  return check.user.map((u) => (u.issue === 'tap' ? null : color[u.verdict]))
}
