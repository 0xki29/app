import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { ErrorBoundary } from '../app/ErrorBoundary'
import { reportError } from '../app/errorReporting'
import { LiveRegion, type Announcement } from '../app/LiveRegion'
import { focusLostHeading } from '../app/screen'
import { useViewportLock } from '../app/viewportLock'
import type { ScoreDebug } from '../debug/DebugHud'
import { useCommitCounter } from '../debug/renderStats'
import { pinyinSyllables } from '../dict/pinyin'
import { HandwritingCanvas } from '../handwriting/HandwritingCanvas'
import { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { referenceProvider, scorer } from '../handwriting/scoring'
import { checkStrokes, type StrokeCheck } from '../strokes/strokeCheck'
import { StrokeAnimator } from '../strokes/StrokeAnimator'
import { strokeSource } from '../strokes/strokeData'
import { useStrokeData } from '../strokes/useStrokeData'
import {
  acceptsInput,
  canScore,
  currentResult,
  INITIAL_PRACTICE,
  isRecallLocked,
  practiceReducer,
  referenceView,
  showsCharacter,
  type Mode,
  type PracticeAction,
  type Rating,
} from './attempt'
import { Controls } from './Controls'
import { prefersReducedMotion } from './motion'
import type { PracticeItem } from './practiceItem'
import { langOf, promptView } from './promptText'
import { ACTIVATION_GUARD_MS, ResultPanel } from './ResultPanel'
import { deriveHeadline, interruptionLines, resultLines, type Tone } from './resultText'
import { summarizeStrokes, type StrokeSummary } from './strokeFeedback'

const MODE_LABEL: Record<Mode, string> = { observe: 'Xem', trace: 'Tô theo', recall: 'Nhớ lại' }
const ALL_MODES: readonly Mode[] = ['observe', 'trace', 'recall']

export const RATING_LABEL: Record<Rating, string> = { correct: 'Đúng', close: 'Gần đúng', wrong: 'Sai' }

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

/** What a self-rating comes with (logged next to it; the rating alone is the grade). */
export interface RatingDetails {
  /** The answer was on screen before this recall: revealed earlier, or the learner asked to see the character. */
  peeked: boolean
  /** The automatic shape score of the rated attempt, when it had one. */
  score: number | null
  strokeSummary: { total: number; good: number; off: number; wrong: number; missing: number; extra: number } | null
  /** From the item appearing to the rating. */
  durationMs: number
}

export interface PracticeWorkspaceProps {
  item: PracticeItem
  /** Identifies the item: a new key starts it afresh, in modes[0] (a session's turn, a character's code point). */
  itemKey: number
  /** The tabs offered, in order. A session shows its steps; free practice all three. */
  modes: readonly Mode[]
  /** The top bar's back button (a session asks before leaving). */
  back: { label: string; onClick: () => void }
  /** Session: which turn this is, of how many ("3 / 12"). */
  progress?: { position: number; total: number }
  /**
   * Recall without Xem (a review turn): offer "Không nhớ?", which opens Xem and Tô theo for this
   * item; its rating is then logged as peeked.
   */
  allowGiveUp?: boolean
  /** The item starts with its answer just seen (a session card re-queued straight after "Sai"): its prompt and rating say so. */
  startPeeked?: boolean
  /**
   * The learner rated the revealed recall. A session records it and gives the next item (a new
   * itemKey); otherwise the item starts over. Returns the toast to show (default: "学 → Đúng").
   */
  onRated?: (rating: Rating, details: RatingDetails) => string | void
  /** Extra actions next to the prompt (free practice: "Thêm vào ôn tập"). */
  aside?: ReactNode
}

/**
 * The writing workspace for one item at a time. The practice flow lives in a pure reducer
 * (attempt.ts); this component renders it and keeps the engine in step: a new attempt resets the
 * box, the phase decides whether it takes input, and scoring reports back only to the attempt that
 * asked. The engine, the canvases and the animator live as long as the workspace: the next item of
 * a session reuses them (iOS limits canvas memory).
 */
export function PracticeWorkspace({ item, itemKey, modes: itemModes, back, progress, allowGiveUp, startPeeked, onRated, aside }: PracticeWorkspaceProps) {
  useCommitCounter('Workspace')
  useViewportLock()
  const [engine] = useState(() => new HandwritingEngine({ desynchronized: params.get('desync') === '1' }))
  const [animator] = useState(() => new StrokeAnimator())
  const [state, dispatch] = useReducer(practiceReducer, INITIAL_PRACTICE, (s) => ({ ...s, index: itemKey, mode: itemModes[0] }))
  // A new item from outside starts afresh, before anything renders with the old item's attempt.
  if (state.index !== itemKey) dispatch({ type: 'item', index: itemKey, mode: itemModes[0] })
  /** The item for which the learner said "Không nhớ?" (Xem and Tô theo are then open). */
  const [gaveUp, setGaveUp] = useState<number | null>(null)
  const forgot = gaveUp === itemKey
  const modes = forgot ? ALL_MODES : itemModes
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
  /** When the item appeared (performance.now()), for the rating's duration. */
  const itemStart = useRef(0)

  const { mode, phase, attemptId, fading } = state
  // Before this attempt the answer was on screen: revealed earlier, "Không nhớ?", or just before (startPeeked).
  const peeked = state.peeked || forgot || !!startPeeked
  const char = item.char
  const stroke = useStrokeData(char)
  const strokeData = stroke.status === 'ready' ? stroke.data : null
  const current = currentResult(state)
  const inputOn = acceptsInput(state)
  const lang = langOf(item.info?.script ?? 'both')

  useEffect(() => {
    itemStart.current = performance.now()
  }, [itemKey])

  // Opened from a link or a button that is gone now (focus on <body>): the prompt takes focus, so a
  // screen reader says what to write.
  useEffect(() => focusLostHeading(promptRef.current, promptRef.current?.closest('.workspace') ?? null), [])

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
  // a new character, or its data arrives (unless the learner paused it; see StrokeAnimator.show).
  // "Xem" tapped again starts no new attempt (attempt.ts), so the learner keeps their place.
  // Outside observe the view is static and detached, so no frames run either way.
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

  // A new id for every toast, so the same text is announced again.
  const setToast = (text: string) => setToastMessage((prev) => ({ id: (prev?.id ?? 0) + 1, text }))

  const go = (next: Mode) => dispatch({ type: 'go', index: itemKey, mode: next })

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
      // The reference waits for the character's stroke data (or falls back to the font glyph when
      // it has none or cannot be fetched); the review uses the same data, if it came.
      const reference = await referenceProvider.getReference(char, lang)
      const result = await scorer.score(ink, reference, mode)
      const data = result.status === 'scored' && reference.fromStrokeData ? strokeSource.entry(char).data : null
      const check = data ? checkStrokes(ink, data, mode) : null
      if (attemptRef.current !== id) return
      // The learner's own strokes take the verdict colors — for this ink only (the revision).
      engine.setStrokeColors(check ? verdictColors(check) : null, ink.revision)
      const ends = ink.strokes.map((s) => s.end)
      dispatch({ type: 'scored', attemptId: id, attempt: { result, check, ends, ms: performance.now() - t0 } })
    } catch (err) {
      reportError('scoring', err, { char, mode })
      if (attemptRef.current !== id) return
      dispatch({ type: 'scoreFailed', attemptId: id })
      setToast('Chưa chấm được. Hãy thử lại.')
    }
  }

  /** The tab after `m` among those offered (Xem → Tô theo → Nhớ lại). */
  const after = (m: Mode): Mode | null => {
    const i = modes.indexOf(m)
    return i >= 0 && i + 1 < modes.length ? modes[i + 1] : null
  }

  const onPrimary = () => {
    if (performance.now() < primaryGuardUntil) return
    if (mode === 'observe') {
      const next = after('observe')
      if (next) moveOn({ type: 'go', index: itemKey, mode: next })
    } else void score()
  }

  const onTab = (next: Mode) => {
    // Recall is locked once its answer is on screen (attempt.ts): say why nothing happens.
    if (next === 'recall' && isRecallLocked(state)) setToast('Đã hiện mẫu: hãy tự đánh giá')
    else go(next)
  }

  const rewrite = () => {
    focusPrompt.current = true
    dispatch({ type: 'rewrite', fade: !prefersReducedMotion() })
  }

  const giveUp = () => {
    setGaveUp(itemKey)
    moveOn({ type: 'go', index: itemKey, mode: 'observe' })
  }

  const onRate = (rating: Rating) => {
    const scored = current?.attempt.result
    const details: RatingDetails = {
      peeked,
      score: scored?.status === 'scored' ? scored.total : null,
      strokeSummary: view?.summary ? tally(view.summary) : null,
      durationMs: performance.now() - itemStart.current,
    }
    const text = onRated?.(rating, details)
    setToast(text || `${char} → ${RATING_LABEL[rating]}`)
    // A session gives the next item in the same update (a new itemKey); otherwise this one starts over.
    moveOn({ type: 'rate', index: itemKey, mode: itemModes[0] })
  }

  const showChar = showsCharacter(state)
  const hidden = !showChar
  const prompt = promptView(item, hidden, peeked)
  const canGiveUp = allowGiveUp && !forgot && !modes.includes('observe') && mode === 'recall' && phase === 'writing'

  return (
    <div className="workspace" data-mode={mode}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={back.label} title={back.label} onClick={back.onClick}>
          <BackIcon />
        </button>
        <div className="modes" role="tablist" aria-label="Chế độ">
          {modes.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === mode} className="modes__tab" onClick={() => onTab(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {progress ? (
          <span className="topbar__progress">
            <span aria-hidden="true">
              {progress.position} / {progress.total}
            </span>
            <span className="sr-only">
              Chữ {progress.position} trên {progress.total}
            </span>
          </span>
        ) : (
          <span className="topbar__spacer" aria-hidden="true" />
        )}
      </header>

      <section className="prompt" aria-label="Chữ cần viết">
        <div className="prompt__main">
          <h1 ref={promptRef} className="prompt__pinyin" tabIndex={-1} lang={prompt.pinyin ? 'zh-Latn-pinyin' : undefined}>
            {prompt.pinyin ? <TonedPinyin numbered={prompt.pinyin} /> : <span className="prompt__pending">{prompt.fallback}</span>}
            {prompt.hanViet && (
              <span className="prompt__hanviet" lang="vi">
                {' '}
                · {prompt.hanViet}
              </span>
            )}
          </h1>
          <p className="prompt__meaning">{prompt.meaning}</p>
          {prompt.context && (
            <p className="prompt__context">
              <span className="sr-only">Trong từ: </span>
              {prompt.context}
            </p>
          )}
          <p className="prompt__extra">{prompt.extra}</p>
        </div>
        <div className="prompt__meta">
          {aside}
          {canGiveUp && (
            <button type="button" className="chip chip--action" onClick={giveUp}>
              Không nhớ?
            </button>
          )}
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
          char={char}
          lang={lang}
          referenceMode={referenceView(state)}
          pulse={pulse}
          fading={fading}
          strokeData={strokeData}
          strokeStatus={stroke.status}
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
            onContinue={() => moveOn({ type: 'go', index: itemKey, mode: after(mode) ?? 'recall' })}
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
            strokeStatus={stroke.status}
            onRetryStrokes={stroke.retry}
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

/** Pinyin with tone marks, each syllable in its tone's color (the mark itself says the tone too). */
function TonedPinyin({ numbered }: { numbered: string }) {
  return pinyinSyllables(numbered).map((s, i) => (
    <span key={i} className={`tone-${s.tone}`}>
      {i > 0 && !s.joined ? ' ' : ''}
      {s.text}
    </span>
  ))
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
      <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function tally(s: StrokeSummary): RatingDetails['strokeSummary'] {
  return { total: s.good + s.off + s.wrong + s.missing, good: s.good, off: s.off, wrong: s.wrong, missing: s.missing, extra: s.extra }
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
