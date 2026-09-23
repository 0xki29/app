import { useCallback, useEffect, useRef, useState } from 'react'
import { langOf, scriptLabel, TEST_CHARS } from '../data/testChars'
import { DebugHud, type ScoreDebug } from '../debug/DebugHud'
import { useCommitCounter } from '../debug/renderStats'
import { HandwritingCanvas, type ReferenceMode } from '../handwriting/HandwritingCanvas'
import { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { referenceProvider, scorer, type Grade } from '../handwriting/scoring'
import { checkStrokes, type StrokeCheck } from '../strokes/strokeCheck'
import { StrokeAnimator } from '../strokes/StrokeAnimator'
import { useStrokeData } from '../strokes/useStrokeData'
import { Controls } from './Controls'
import { prefersReducedMotion } from './motion'
import { ResultPanel } from './ResultPanel'

export type Mode = 'observe' | 'trace' | 'recall'
export type Rating = 'correct' | 'close' | 'wrong'
/** writing → scoring (async) → scored → revealed (recall only). */
type Phase = 'writing' | 'scoring' | 'scored' | 'revealed'

const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'observe', label: 'Xem' },
  { id: 'trace', label: 'Tô theo' },
  { id: 'recall', label: 'Nhớ lại' },
]

const RATING_LABEL: Record<Rating, string> = { correct: 'Đúng', close: 'Gần đúng', wrong: 'Sai' }

const GRADE_COLOR: Record<Grade, string> = {
  excellent: 'var(--correct)',
  good: 'var(--correct)',
  fair: 'var(--close)',
  'needs-work': 'var(--wrong)',
}

/** Ink fade before a rewrite clears the box. */
const REWRITE_FADE_MS = 220

const params = new URLSearchParams(window.location.search)
const debugAvailable = import.meta.env.DEV || params.has('debug')

export function WorkspaceScreen() {
  useCommitCounter('Workspace')
  const [engine] = useState(() => new HandwritingEngine({ desynchronized: params.get('desync') === '1' }))
  const [animator] = useState(() => new StrokeAnimator())
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('observe')
  const [phase, setPhase] = useState<Phase>('writing')
  const [fading, setFading] = useState(false)
  const [lastScore, setLastScore] = useState<ScoreDebug | null>(null)
  /** Stroke-by-stroke verdicts for lastScore (characters with stroke data). */
  const [strokeCheck, setStrokeCheck] = useState<StrokeCheck | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [hudOpen, setHudOpen] = useState(() => params.get('debug') === '1')
  /** Bumped whenever the box is reset; async scoring and delayed clears check it. */
  const attempt = useRef(0)
  const fadeTimer = useRef(0)

  const item = TEST_CHARS[index]
  const count = TEST_CHARS.length
  const strokeData = useStrokeData(item.char)

  // Every character/mode gets a fresh box.
  useEffect(() => {
    engine.reset()
  }, [engine, index, mode])

  useEffect(() => {
    animator.setData(strokeData)
  }, [animator, strokeData])

  // Stroke order plays only in observe: from the first stroke whenever observe is entered or shows a
  // new character (unless the learner paused it; see StrokeAnimator.show). Outside observe the view
  // is static and detached, so no frames run either way.
  useEffect(() => {
    if (mode === 'observe') animator.show()
    else animator.pause()
  }, [animator, mode, strokeData])

  useEffect(() => {
    engine.setInputEnabled(mode !== 'observe' && phase === 'writing' && !fading)
  }, [engine, mode, phase, fading])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => () => window.clearTimeout(fadeTimer.current), [])

  const go = useCallback((nextIndex: number, nextMode: Mode) => {
    attempt.current++
    window.clearTimeout(fadeTimer.current)
    setIndex(nextIndex)
    setMode(nextMode)
    setPhase('writing')
    setFading(false)
  }, [])

  const score = async () => {
    if (mode === 'observe' || phase !== 'writing') return
    const token = ++attempt.current
    setPhase('scoring')
    const t0 = performance.now()
    try {
      const ink = engine.getInk()
      const reference = await referenceProvider.getReference(item.char, langOf(item), item.strokeCount)
      const result = await scorer.score(ink, reference, mode)
      if (token !== attempt.current) return
      const check = strokeData && result.status === 'scored' ? checkStrokes(ink, strokeData, mode) : null
      // The learner's own strokes take the verdict colors; any new ink or reset drops them.
      engine.setStrokeColors(check ? verdictColors(check) : null)
      setLastScore((prev) => ({ result, ms: performance.now() - t0, seq: (prev?.seq ?? 0) + 1 }))
      setStrokeCheck(check)
      // Recall with stroke data shows the reference and the marks at once — nothing left to reveal.
      setPhase(mode === 'recall' && check ? 'revealed' : 'scored')
    } catch (err) {
      console.error('[scoring]', err)
      if (token === attempt.current) setPhase('writing')
    }
  }

  const onPrimary = () => {
    if (mode === 'observe') go(index, 'trace')
    else void score()
  }

  const rewrite = () => {
    const token = ++attempt.current
    const clear = () => {
      if (token !== attempt.current) return
      engine.reset()
      setFading(false)
      setPhase('writing')
    }
    if (prefersReducedMotion()) {
      clear()
      return
    }
    setFading(true)
    fadeTimer.current = window.setTimeout(clear, REWRITE_FADE_MS)
  }

  const onRate = (rating: Rating) => {
    console.log('[rating]', { char: item.char, rating, score: lastScore?.result.total, ink: engine.getInk() })
    const wrapped = index + 1 >= count
    setToast(`${item.char} → ${RATING_LABEL[rating]}${wrapped ? ' · quay lại chữ đầu' : ''}`)
    go(wrapped ? 0 : index + 1, 'observe')
  }

  const showResult = phase === 'scored' || phase === 'revealed'
  const result = showResult ? (lastScore?.result ?? null) : null
  const review = showResult ? strokeCheck : null
  const referenceMode: ReferenceMode =
    mode === 'observe'
      ? 'observe'
      : mode === 'trace'
        ? 'trace'
        : phase === 'revealed'
          ? review
            ? 'review'
            : 'reveal'
          : 'hidden'
  const pulse =
    result && lastScore
      ? { key: lastScore.seq, color: result.status === 'scored' ? GRADE_COLOR[result.grade] : 'var(--muted)' }
      : null
  const script = scriptLabel(item)
  const showChar = mode !== 'recall' || phase === 'revealed'

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
              onClick={() => go(index, m.id)}
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

      <section className="prompt">
        <div className="prompt__main">
          <div className="prompt__pinyin">
            {item.pinyin}
            {showChar && <span className="prompt__hanviet"> · {item.hanViet}</span>}
          </div>
          <div className="prompt__meaning">{item.meaningVi}</div>
          <div className="prompt__extra">
            {mode === 'recall' && !showChar ? (
              'Viết chữ này từ trí nhớ'
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
          </div>
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
          referenceMode={referenceMode}
          pulse={pulse}
          fading={fading}
          strokeData={strokeData}
          animator={animator}
          review={review}
        />
      </main>

      <div className="dock">
        {result && lastScore ? (
          <ResultPanel
            key={lastScore.seq}
            result={result}
            mode={mode}
            revealed={phase === 'revealed'}
            strokes={review}
            onRetry={rewrite}
            onContinue={() => go(index, 'recall')}
            onReveal={() => setPhase('revealed')}
            onRate={onRate}
          />
        ) : (
          <Controls
            engine={engine}
            mode={mode}
            scoring={phase === 'scoring'}
            onPrimary={onPrimary}
            animator={animator}
            strokeGuide={strokeData !== null}
          />
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {hudOpen && <DebugHud engine={engine} score={lastScore} onClose={() => setHudOpen(false)} />}
    </div>
  )
}

/** The canvas needs concrete colors: the verdict tokens, read from the stylesheet. */
function verdictColors(check: StrokeCheck): (string | null)[] {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(name).trim() || null
  const color = { good: token('--correct'), off: token('--close'), wrong: token('--wrong') }
  return check.user.map((u) => color[u.verdict])
}
