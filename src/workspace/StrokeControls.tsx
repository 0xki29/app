import { useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { StrokeAnimator } from '../strokes/StrokeAnimator'
import type { Pace } from '../strokes/timeline'

interface Props {
  animator: StrokeAnimator
}

const PACES: readonly { id: Pace; label: string }[] = [
  { id: 'slow', label: 'Chậm' },
  { id: 'normal', label: 'Vừa' },
]

/**
 * Stroke-order playback controls (Xem). The only component subscribed to the animator: it re-renders
 * about once per stroke while the animation plays; the workspace and the canvas do not.
 *
 * Icon buttons are named by `title` alone (it is also the hover tooltip): an aria-label next to it
 * would make screen readers read the same text twice, as name and description.
 */
export function StrokeControls({ animator }: Props) {
  useCommitCounter('StrokeControls')
  const { available, playing, pace, stroke, total, complete } = useSyncExternalStore(
    animator.subscribe,
    animator.getSnapshot,
  )
  const liveRef = useRef<HTMLSpanElement>(null)
  const paceRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Prev/next use aria-disabled, never `disabled`: a focused button that turns disabled drops keyboard
  // focus to <body>, and the loop would do that on its own every round. While playing both always act
  // (next in the hold pauses on the whole character, prev in the lead on the empty box), so they are
  // only unavailable when paused at an end.
  const atStart = !playing && stroke === 0
  const atEnd = !playing && complete

  // Autoplay is not announced (a message per stroke would be noise); a step the user asked for is.
  // Cleared first, so the same text (another character, same stroke number) is announced again.
  const announce = (text: string) => {
    const el = liveRef.current
    if (!el) return
    el.textContent = ''
    window.requestAnimationFrame(() => {
      el.textContent = text
    })
  }

  const step = (dir: 'prev' | 'next') => {
    if (!available || (dir === 'prev' ? atStart : atEnd)) return
    if (dir === 'prev') animator.prev()
    else animator.next()
    const s = animator.getSnapshot()
    announce(s.stroke === 0 ? 'Chưa có nét nào' : `Nét ${s.stroke} trên ${s.total}`)
  }

  // One choice of two: a radio group, with arrow keys moving the choice (roving tabindex).
  const onPaceKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const i = (PACES.findIndex((p) => p.id === pace) + delta + PACES.length) % PACES.length
    animator.setPace(PACES[i].id)
    paceRefs.current[i]?.focus()
  }

  return (
    <div className="strokebar">
      <div className="strokebar__status">
        <span className="strokebar__count">
          Nét{' '}
          <strong>
            {available ? stroke : '–'}/{available ? total : '–'}
          </strong>
        </span>
        <span className="sr-only" aria-live="polite" ref={liveRef} />
        <div className="pace" role="radiogroup" aria-label="Tốc độ">
          {PACES.map((p, i) => (
            <button
              key={p.id}
              ref={(el) => {
                paceRefs.current[i] = el
              }}
              type="button"
              role="radio"
              className="pace__opt"
              aria-checked={pace === p.id}
              tabIndex={pace === p.id ? 0 : -1}
              onClick={() => animator.setPace(p.id)}
              onKeyDown={onPaceKey}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="strokebar__transport">
        <button
          type="button"
          className="btn strokebar__btn"
          title="Xem lại từ đầu"
          disabled={!available}
          onClick={() => animator.replay()}
        >
          <ReplayIcon />
        </button>
        <button
          type="button"
          className="btn strokebar__btn"
          title="Nét trước"
          disabled={!available}
          aria-disabled={atStart || undefined}
          onClick={() => step('prev')}
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          className="btn strokebar__btn"
          title={playing ? 'Tạm dừng' : 'Phát'}
          disabled={!available}
          onClick={() => animator.toggle()}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="btn strokebar__btn"
          title="Nét sau"
          disabled={!available}
          aria-disabled={atEnd || undefined}
          onClick={() => step('next')}
        >
          <StepForwardIcon />
        </button>
      </div>
    </div>
  )
}

// Drawn rather than ↺ ⏸ ▶ characters: some phones render those as color emoji, and text glyphs
// would not match in weight. The step icons have a bar, so they do not read as the ‹ › that change
// the character in the top bar.
function PlayIcon() {
  return (
    <svg className="strokebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l10.5-6.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="strokebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
      <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
    </svg>
  )
}

function ReplayIcon() {
  return (
    <svg className="strokebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path className="strokebar__icon-line" d="M6.4 9.8A6.5 6.5 0 1 0 12 6.5" />
      <path d="M8.6 6.5 13.3 2.9v7.2z" />
    </svg>
  )
}

function StepBackIcon() {
  return (
    <svg className="strokebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="6" width="3" height="12" rx="1" />
      <path d="M18.5 6v12L9.8 12z" />
    </svg>
  )
}

function StepForwardIcon() {
  return (
    <svg className="strokebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="15.5" y="6" width="3" height="12" rx="1" />
      <path d="M5.5 6v12l8.7-6z" />
    </svg>
  )
}
