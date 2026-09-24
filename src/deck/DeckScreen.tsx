import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { practiceHref } from '../app/router'
import { deck } from './api'
import './deck.css'
import { DeckErrorNotice } from './DeckErrorNotice'
import { cardDueText, STATE_LABEL } from './dueText'
import { deckErrorText, useDeckQuery } from './hooks'
import type { CardRecord, DeckSettings } from './types'

const NEW_PER_DAY = [5, 10, 15, 20, 30]

/**
 * "Sổ ôn tập": every card, what is due next first (new cards last, in the order they will come),
 * with its context word and when it is due; remove a card (asked first); new cards per day; export
 * and import the whole deck as a JSON file (to move it to another device, or keep a copy).
 */
export function DeckScreen() {
  const [tick, setTick] = useState(0)
  // The due texts are worded against the time the list was read: read again on every change, and
  // when the app comes back to the foreground.
  const cards = useDeckQuery(async () => ({ list: await deck.list(), now: Date.now() }), tick)
  const settings = useDeckQuery(() => deck.settings())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const perDayId = useId()

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const sorted = useMemo(() => (cards.status === 'ready' ? sortCards(cards.data.list) : []), [cards])
  const now = cards.status === 'ready' ? cards.data.now : 0
  const hour = settings.status === 'ready' ? settings.data.dayStartHour : 4

  const remove = async (card: CardRecord) => {
    setConfirming(null)
    try {
      await deck.remove(card.char)
      setMessage({ text: `Đã bỏ ${card.char} khỏi sổ.` })
    } catch (err) {
      console.error('[deck] remove failed', err)
      setMessage({ text: deckErrorText(err), error: true })
    }
  }

  const setPerDay = async (value: number) => {
    try {
      await deck.setSettings({ newPerDay: value } satisfies Partial<DeckSettings>)
    } catch (err) {
      setMessage({ text: deckErrorText(err), error: true })
    }
  }

  const exportDeck = async () => {
    try {
      const data = await deck.exportData()
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `so-on-tap-${data.exportedAt.slice(0, 10)}.json`
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setMessage({ text: `Đã xuất ${data.cards.length} thẻ và ${data.reviews.length} lượt ôn.` })
    } catch (err) {
      console.error('[deck] export failed', err)
      setMessage({ text: deckErrorText(err), error: true })
    }
  }

  const importDeck = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      setMessage({ text: 'Tệp này không đọc được (không phải tệp JSON xuất từ sổ ôn tập).', error: true })
      return
    }
    try {
      const r = await deck.importData(json)
      const parts = [`${r.cardsAdded} thẻ mới`, `${r.reviewsAdded} lượt ôn`]
      if (r.cardsUpdated) parts.push(`${r.cardsUpdated} thẻ cập nhật`)
      if (r.cardsRemoved) parts.push(`${r.cardsRemoved} thẻ đã bỏ khỏi sổ ở máy kia`)
      if (r.skipped) parts.push(`${r.skipped} mục lỗi bị bỏ qua`)
      setMessage({ text: `Đã nhập: ${parts.join(', ')}.` })
    } catch (err) {
      console.error('[deck] import failed', err)
      setMessage({ text: deckErrorText(err), error: true })
    }
  }

  return (
    <main className="page deck">
      <header className="page__head">
        <h1 className="page__title" tabIndex={-1}>
          Sổ ôn tập
        </h1>
        {cards.status === 'ready' && <p className="page__muted">{cards.data.list.length} chữ</p>}
      </header>

      {cards.status === 'loading' && <p className="page__muted">Đang mở sổ ôn tập…</p>}
      {cards.status === 'error' && <DeckErrorNotice error={cards.error} />}
      {cards.status === 'ready' && sorted.length === 0 && (
        <p className="deck__empty">
          Sổ chưa có chữ nào. <a href="#/">Thêm chữ HSK 1</a> hoặc <a href="#/tra-cuu">tra cứu để thêm chữ</a>.
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="deck-list">
          {sorted.map((card) => (
            <li key={card.id} className="deck-card">
              <a className="deck-card__char" href={practiceHref(card.char)} lang="zh-Hans" aria-label={`Luyện viết ${card.char}`}>
                {card.char}
              </a>
              <div className="deck-card__body">
                {card.context && (
                  <p className="deck-card__context">
                    <span lang="zh-Hans">{card.context.simp}</span>
                    {card.context.vi && ` · ${card.context.vi}`}
                  </p>
                )}
                <p className="deck-card__due">
                  <span className={`deck-state deck-state--${card.fsrs.state}`}>{STATE_LABEL[card.fsrs.state]}</span>
                  {card.fsrs.state !== 'new' && ` · ôn ${cardDueText(card.fsrs, now, hour)}`}
                </p>
              </div>
              {confirming === card.id ? (
                <div className="deck-card__confirm" role="group" aria-label={`Bỏ ${card.char} khỏi sổ?`}>
                  <button type="button" className="btn btn--small" autoFocus onClick={() => setConfirming(null)}>
                    Giữ
                  </button>
                  <button type="button" className="btn btn--small btn--danger" onClick={() => void remove(card)}>
                    Bỏ
                  </button>
                </div>
              ) : (
                <button type="button" className="deck-card__remove" aria-label={`Bỏ ${card.char} khỏi sổ`} onClick={() => setConfirming(card.id)}>
                  <RemoveIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className={message?.error ? 'page__msg page__msg--error' : 'page__msg'} role="status">
        {message?.text}
      </p>

      <section className="deck__section" aria-labelledby="deck-settings-h">
        <h2 id="deck-settings-h" className="page__subtitle">
          Cài đặt
        </h2>
        <p className="deck__setting">
          <label htmlFor={perDayId}>Chữ mới mỗi ngày</label>
          <select
            id={perDayId}
            className="deck__select"
            value={settings.status === 'ready' ? settings.data.newPerDay : 10}
            disabled={settings.status !== 'ready'}
            onChange={(e) => void setPerDay(Number(e.target.value))}
          >
            {NEW_PER_DAY.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </p>
        <p className="page__muted">Một ngày học bắt đầu lúc 4 giờ sáng: ôn lúc nửa đêm vẫn tính cho hôm trước.</p>
      </section>

      <section className="deck__section" aria-labelledby="deck-data-h">
        <h2 id="deck-data-h" className="page__subtitle">
          Sao lưu
        </h2>
        <p className="page__muted">
          Sổ ôn tập chỉ lưu trên máy này, trong trình duyệt. Xuất ra tệp để giữ một bản, hoặc chuyển sang máy khác rồi nhập
          vào: thẻ và lượt ôn được gộp, không mất gì; thẻ đã bỏ khỏi sổ ở một bên thì không quay lại.
        </p>
        <div className="deck__actions">
          <button type="button" className="btn" onClick={() => void exportDeck()} disabled={cards.status !== 'ready'}>
            Xuất dữ liệu
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={cards.status === 'error'}>
            Nhập dữ liệu
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importDeck(e)} />
        </div>
      </section>
    </main>
  )
}

/** Due first (soonest first), then new cards in the order they will be introduced. */
function sortCards(cards: readonly CardRecord[]): CardRecord[] {
  return [...cards].sort((a, b) => {
    const an = a.fsrs.state === 'new'
    const bn = b.fsrs.state === 'new'
    if (an !== bn) return an ? 1 : -1
    return an ? a.addedAt - b.addedAt : a.fsrs.due - b.fsrs.due
  })
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
