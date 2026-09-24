import { useEffect, useState } from 'react'
import { deck } from './api'
import type { HskProgress, Today } from './deck'
import './deck.css'
import { DeckErrorNotice } from './DeckErrorNotice'
import { dueText } from './dueText'
import { deckErrorText, useDeckQuery, type Query } from './hooks'
import { nextDayStart } from './scheduler'
import type { DeckSettings } from './types'

const HSK_BATCH = 10
/** Timers further off than this are not set: coming back to the tab refreshes anyway. */
const MAX_WAIT_MS = 25 * 60 * 60_000

/**
 * Home ("Hôm nay"): how many characters are due and how many new ones today, and the button that
 * starts the session. An empty deck offers the next characters of the HSK 3.0 level-1 writing list
 * and the dictionary. No streaks, no points: just what is due.
 */
export function TodayScreen() {
  const [tick, setTick] = useState(0)
  const today = useDeckQuery(() => deck.today(), tick)
  const settings = useDeckQuery(() => deck.settings())
  // Read again with the counts: a list that failed to load (offline) comes back by itself.
  const hsk = useDeckQuery(() => deck.hskProgress(1), tick)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  // A card in a learning step comes due minutes later, and a new learning day starts at night
  // (dayStartHour): look again at whichever comes first, when the app comes back to the
  // foreground, and when the network is back.
  const nextDue = today.status === 'ready' ? today.data.nextDue : null
  const dayEnd = today.status === 'ready' ? nextDayStart(today.data.now, today.data.dayStartHour) : null
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    const at = Math.min(nextDue ?? Infinity, dayEnd ?? Infinity)
    const wait = at - Date.now()
    const id = wait < MAX_WAIT_MS ? window.setTimeout(refresh, Math.max(1000, wait + 500)) : undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
      window.clearTimeout(id)
    }
  }, [nextDue, dayEnd])

  const addHsk = async () => {
    if (adding) return
    setAdding(true)
    setMessage(null)
    try {
      const r = await deck.addNextHsk(1, HSK_BATCH)
      setMessage({ text: r.added ? `Đã thêm ${r.added} chữ: ${r.chars.join(' ')}` : 'Không còn chữ HSK 1 nào để thêm.' })
    } catch (err) {
      console.error('[deck] adding HSK characters failed', err)
      setMessage({ text: deckErrorText(err), error: true })
    } finally {
      setAdding(false)
    }
  }

  const hskLeft = hsk.status === 'ready' && hsk.data ? hsk.data.total - hsk.data.cursor : 0
  const perDay = settings.status === 'ready' ? settings.data.newPerDay : null

  return (
    <main className="page today">
      <header className="page__head">
        <h1 className="page__title" tabIndex={-1}>
          Hôm nay
        </h1>
      </header>

      {today.status === 'loading' && <p className="page__muted">Đang mở sổ ôn tập…</p>}
      {today.status === 'error' && <DeckErrorNotice error={today.error} />}
      {today.status === 'ready' &&
        (today.data.total === 0 ? (
          <EmptyDeck hsk={hsk} hskLeft={hskLeft} adding={adding} onAddHsk={() => void addHsk()} onRetry={() => setTick((t) => t + 1)} />
        ) : (
          <Plan today={today.data} perDay={perDay} hskLeft={hskLeft} adding={adding} onAddHsk={() => void addHsk()} />
        ))}

      <p className={message?.error ? 'page__msg page__msg--error' : 'page__msg'} role="status">
        {message?.text}
      </p>
    </main>
  )
}

function Plan({
  today,
  perDay,
  hskLeft,
  adding,
  onAddHsk,
}: {
  today: Today
  perDay: DeckSettings['newPerDay'] | null
  hskLeft: number
  adding: boolean
  onAddHsk: () => void
}) {
  const work = today.due + today.fresh
  return (
    <>
      <section className="today__plan" aria-labelledby="today-plan-h">
        <h2 id="today-plan-h" className="sr-only">
          Việc hôm nay
        </h2>
        <dl className="today__counts">
          <div className="today__count">
            <dt>Cần ôn</dt>
            <dd>{today.due}</dd>
          </div>
          <div className="today__count">
            <dt>Chữ mới</dt>
            <dd>{today.fresh}</dd>
          </div>
        </dl>
        {work > 0 ? (
          <a className="btn btn--primary btn--wide" href="#/on-tap">
            Bắt đầu ôn
          </a>
        ) : (
          <p className="today__done">
            Hôm nay đã ôn xong.
            {today.nextDue !== null && ` Lần ôn tới: ${dueText(today.nextDue, today.now, today.dayStartHour)}.`}
          </p>
        )}
        {today.laterToday > 0 && (
          <p className="page__muted">{today.laterToday} chữ vừa học sẽ cần ôn lại trong hôm nay, sau ít phút.</p>
        )}
        {today.newWaiting > 0 && (
          <p className="page__muted">
            Còn {today.newWaiting} chữ mới chờ tới lượt{perDay !== null ? ` (mỗi ngày ${perDay} chữ)` : ''}.
          </p>
        )}
      </section>

      <section className="today__more" aria-labelledby="today-more-h">
        <h2 id="today-more-h" className="page__subtitle">
          Thêm chữ
        </h2>
        <div className="today__actions">
          {today.fresh === 0 && today.newWaiting === 0 && hskLeft > 0 && (
            <button type="button" className="btn btn--wide" aria-disabled={adding || undefined} onClick={onAddHsk}>
              {adding ? 'Đang thêm…' : `Thêm ${Math.min(HSK_BATCH, hskLeft)} chữ HSK 1 tiếp theo`}
            </button>
          )}
          <a className="btn btn--wide" href="#/tra-cuu">
            Tra cứu để thêm chữ
          </a>
        </div>
        <p className="page__muted">
          Sổ có {today.total} chữ. <a href="#/so-on-tap">Xem sổ ôn tập</a>
        </p>
      </section>
    </>
  )
}

function EmptyDeck({
  hsk,
  hskLeft,
  adding,
  onAddHsk,
  onRetry,
}: {
  hsk: Query<HskProgress | null>
  hskLeft: number
  adding: boolean
  onAddHsk: () => void
  onRetry: () => void
}) {
  return (
    <section className="today__empty" aria-labelledby="today-empty-h">
      <h2 id="today-empty-h" className="page__subtitle">
        Sổ ôn tập đang trống
      </h2>
      <p>
        Mỗi chữ trong sổ là một thẻ luyện viết. Ứng dụng xếp lịch ôn: mỗi khi bạn mở mục Hôm nay, chữ nào sắp quên sẽ được
        đưa ra để viết lại từ trí nhớ, dựa trên cách bạn tự đánh giá mỗi lần viết.
      </p>
      <div className="today__actions">
        {hskLeft > 0 && (
          <button type="button" className="btn btn--primary btn--wide" aria-disabled={adding || undefined} onClick={onAddHsk}>
            {adding ? 'Đang thêm…' : `Thêm ${Math.min(HSK_BATCH, hskLeft)} chữ HSK 1`}
          </button>
        )}
        {hsk.status === 'error' && (
          <button type="button" className="btn btn--wide" onClick={onRetry}>
            Thử tải lại danh sách chữ HSK
          </button>
        )}
        <a className={hskLeft > 0 ? 'btn btn--wide' : 'btn btn--primary btn--wide'} href="#/tra-cuu">
          Tra cứu để thêm chữ
        </a>
      </div>
      {hskLeft > 0 ? (
        <p className="page__muted">
          Chữ thường gặp nhất trước, trong 300 chữ viết HSK 3.0 cấp 1; mỗi lần 10 chữ, mỗi chữ kèm một từ có chữ đó.
        </p>
      ) : hsk.status === 'error' ? (
        <p className="page__muted">Chưa tải được danh sách chữ HSK 1. Hãy kiểm tra kết nối mạng rồi thử lại.</p>
      ) : (
        hsk.status === 'ready' &&
        hsk.data === null && (
          <p className="page__muted">
            Chưa có danh sách chữ HSK trong dữ liệu của ứng dụng.{import.meta.env.DEV && ' (Máy chủ phát triển: chạy npm run data:build.)'}
          </p>
        )
      )}
    </section>
  )
}
