import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { ConfirmDialog } from '../app/ConfirmDialog'
import { reportError } from '../app/errorReporting'
import { backLinkClick } from '../app/history'
import { LiveRegion, type Announcement } from '../app/LiveRegion'
import { strokeSource } from '../strokes/strokeData'
import type { Rating } from '../workspace/attempt'
import { PracticeWorkspace, RATING_LABEL, type RatingDetails } from '../workspace/PracticeWorkspace'
import { deck } from './api'
import { prefetchCharInfo, usePracticeItem } from './charInfo'
import type { StudyItem, Today } from './deck'
import './deck.css'
import { DeckErrorNotice } from './DeckErrorNotice'
import { dueText } from './dueText'
import { MAX_REQUEUES, modesFor, REQUEUE_GAP, sessionProgress, sessionReducer, startSession, summarize, type SessionState, type SessionTurn } from './session'

type Start = { status: 'loading' } | { status: 'ready'; items: StudyItem[] } | { status: 'error'; error: unknown }

/**
 * "Ôn tập" (#/on-tap): today's queue from the deck, studied card by card in the practice
 * workspace, each rating recorded as it is made; then a summary. Leaving asks first (what was rated
 * is kept either way). "Ôn tiếp" on the summary starts a new session with what is due by then.
 */
export function SessionScreen() {
  const [round, setRound] = useState(0)
  const [start, setStart] = useState<Start & { round: number }>({ status: 'loading', round: 0 })

  useEffect(() => {
    let alive = true
    deck.today().then(
      (t) => {
        if (alive) setStart({ status: 'ready', items: t.queue, round })
      },
      (error: unknown) => {
        if (alive) setStart({ status: 'error', error, round })
      },
    )
    return () => {
      alive = false
    }
  }, [round])

  if (start.round !== round || start.status === 'loading')
    return (
      <main className="page">
        <p className="page__muted" aria-busy="true">
          Đang chuẩn bị buổi ôn…
        </p>
      </main>
    )
  if (start.status === 'error')
    return (
      <main className="page">
        <h1 className="page__title" tabIndex={-1}>
          Ôn tập
        </h1>
        <DeckErrorNotice error={start.error} />
        <HomeLink className="btn btn--wide" />
      </main>
    )
  if (start.items.length === 0)
    return (
      <main className="page">
        <h1 className="page__title" tabIndex={-1}>
          Ôn tập
        </h1>
        <p>Lúc này không có chữ nào cần ôn.</p>
        <HomeLink className="btn btn--primary btn--wide" />
      </main>
    )
  return <Session key={round} items={start.items} onAgain={() => setRound((r) => r + 1)} />
}

/** "Về trang Hôm nay": back, when the session was opened from Hôm nay (the phone's Back then leaves, not into the session again). */
function HomeLink({ className }: { className: string }) {
  return (
    <a className={className} href="#/" onClick={backLinkClick('#/')}>
      Về trang Hôm nay
    </a>
  )
}

function Session({ items, onAgain }: { items: StudyItem[]; onAgain: () => void }) {
  const [state, dispatch] = useReducer(sessionReducer, items, startSession)
  const [saveError, setSaveError] = useState(false)
  /** The last rating's toast: the workspace that shows it goes away with the last card, so the summary says it. */
  const [lastRating, setLastRating] = useState('')
  // Outlives the workspace (whose own region carries the toasts during the session): the end of
  // the session and its results are announced here.
  const [said, setSaid] = useState<Announcement | null>(null)

  const onRated = (turn: SessionTurn, rating: Rating, details: RatingDetails): string => {
    dispatch({ type: 'rated', turn: turn.turn, rating })
    deck.review(turn.cardId, rating, { mode: turn.mode, ...details }).catch((err: unknown) => {
      reportError('deck', err, { cardId: turn.cardId })
      setSaveError(true)
    })
    // What the reducer does with a "Sai" (session.ts), said in the toast.
    const again = rating === 'wrong' && (state.requeued[turn.cardId] ?? 0) < MAX_REQUEUES
    const gap = Math.min(REQUEUE_GAP, state.upcoming.length)
    const later = again ? (gap ? ` · ôn lại sau ${gap} chữ` : ' · ôn lại ngay') : ''
    const text = `${turn.char} → ${RATING_LABEL[rating]}${later}`
    setLastRating(text)
    return text
  }

  return (
    <>
      {state.current ? (
        <Turn state={state} turn={state.current} onRated={onRated} onQuit={() => dispatch({ type: 'quit' })} saveError={saveError} />
      ) : (
        <Summary state={state} saveError={saveError} onAgain={onAgain} lastRating={lastRating} announce={(text) => setSaid({ id: 1, text })} />
      )}
      <LiveRegion message={said} />
    </>
  )
}

/**
 * The card on screen. One workspace for the whole session: the next card arrives as a new itemKey
 * (the turn), so the engine and its canvases are reused.
 */
function Turn({
  state,
  turn,
  onRated,
  onQuit,
  saveError,
}: {
  state: SessionState
  turn: SessionTurn
  onRated: (turn: SessionTurn, rating: Rating, details: RatingDetails) => string
  onQuit: () => void
  saveError: boolean
}) {
  const [asking, setAsking] = useState(false)
  const item = usePracticeItem(turn.char, turn.context)
  const next = state.upcoming[0]?.char
  const rated = summarize(state).chars

  // The next card's prompt and strokes load while this one is written.
  useEffect(() => {
    if (!next) return
    prefetchCharInfo(next)
    strokeSource.ensure(next)
  }, [next])

  return (
    <>
      <PracticeWorkspace
        item={item}
        itemKey={turn.turn}
        modes={modesFor(turn.mode)}
        back={{ label: 'Dừng buổi ôn', onClick: () => setAsking(true) }}
        progress={sessionProgress(state)}
        allowGiveUp={turn.mode !== 'new'}
        startPeeked={turn.peeked}
        onRated={(rating, details) => onRated(turn, rating, details)}
      />
      {saveError && (
        <p className="session__warn" role="alert">
          Chưa lưu được một kết quả vào sổ ôn tập.
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title="Dừng buổi ôn?"
          text={
            rated
              ? `Kết quả của ${rated} chữ đã tự đánh giá vẫn được lưu. Những chữ chưa ôn sẽ chờ lần sau.`
              : 'Chưa có chữ nào được tự đánh giá. Những chữ chưa ôn sẽ chờ lần sau.'
          }
          cancelLabel="Ôn tiếp"
          confirmLabel="Dừng"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            onQuit()
          }}
        />
      )}
    </>
  )
}

function Summary({
  state,
  saveError,
  onAgain,
  lastRating,
  announce,
}: {
  state: SessionState
  saveError: boolean
  onAgain: () => void
  lastRating: string
  announce: (text: string) => void
}) {
  const s = summarize(state)
  const [after, setAfter] = useState<Today | null>(null)
  const title = state.ended === 'quit' ? 'Đã dừng buổi ôn' : 'Xong buổi ôn'
  const h1 = useRef<HTMLHeadingElement>(null)

  // The workspace and its buttons are gone: focus goes to the heading (read out as it takes focus),
  // and the last rating and the results are announced, once, when the summary appears.
  const shown = useEffectEvent(() => {
    h1.current?.focus({ preventScroll: true })
    const counts = s.ratings
      ? `${s.chars} chữ, ${s.ratings} lượt tự đánh giá: ${s.correct} Đúng, ${s.close} Gần đúng, ${s.wrong} Sai.`
      : 'Chưa ôn chữ nào trong buổi này.'
    // The last rating went unannounced only when it ended the session (its workspace went away).
    announce([state.ended === 'done' ? lastRating : '', counts].filter(Boolean).join('. '))
  })
  useEffect(() => shown(), [])

  // Read after every rating of the session is stored (the deck orders its writes).
  useEffect(() => {
    let alive = true
    deck.today().then(
      (t) => {
        if (alive) setAfter(t)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [])

  const moreNow = after ? after.due + after.fresh : 0
  return (
    <main className="page session-summary">
      <header className="page__head">
        <h1 ref={h1} className="page__title" tabIndex={-1}>
          {title}
        </h1>
      </header>
      {s.ratings === 0 ? (
        <p>Chưa ôn chữ nào trong buổi này.</p>
      ) : (
        <>
          <p className="session-summary__lead">
            {s.chars} chữ · {s.ratings} lượt tự đánh giá
          </p>
          <ul className="session-summary__counts">
            <li className="session-summary__count" data-v="correct">
              <span className="session-summary__num">{s.correct}</span> Đúng
            </li>
            <li className="session-summary__count" data-v="close">
              <span className="session-summary__num">{s.close}</span> Gần đúng
            </li>
            <li className="session-summary__count" data-v="wrong">
              <span className="session-summary__num">{s.wrong}</span> Sai
            </li>
          </ul>
        </>
      )}
      {saveError && (
        <p className="notice notice--error" role="alert">
          Có kết quả chưa lưu được vào sổ ôn tập (bộ nhớ của trình duyệt báo lỗi).
        </p>
      )}
      {after && (
        <p className="page__muted">
          {moreNow > 0
            ? `Còn ${moreNow} chữ cần ôn ngay.`
            : after.nextDue !== null
              ? `Lần ôn tới: ${dueText(after.nextDue, after.now, after.dayStartHour)}.`
              : 'Không còn chữ nào chờ ôn.'}
        </p>
      )}
      <div className="today__actions">
        {moreNow > 0 && (
          <button type="button" className="btn btn--primary btn--wide" onClick={onAgain}>
            Ôn tiếp
          </button>
        )}
        <HomeLink className={moreNow > 0 ? 'btn btn--wide' : 'btn btn--primary btn--wide'} />
      </div>
    </main>
  )
}
