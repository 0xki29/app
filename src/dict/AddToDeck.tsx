import { useEffect, useId, useState } from 'react'
import { deck } from '../deck/api'
import { deckErrorText } from '../deck/hooks'
import { DECK_HREF } from './links'
import type { WordChar } from './protocol'
import { firstMeaning } from './senses'
import type { DictEntry } from './types'

/**
 * "Thêm vào sổ ôn tập": one writing card per character of the word that has stroke data, each
 * keeping the word as its context. Says what happened (added, already there, left out for lack of
 * stroke data) in a live region; says beforehand when nothing can be added, and why — the browser
 * keeping no data included.
 */
export function AddToDeck({ entry, chars }: { entry: DictEntry; chars: readonly WordChar[] }) {
  const writable = chars.filter((c) => c.hasStrokes).map((c) => c.char)
  const missing = chars.filter((c) => !c.hasStrokes).map((c) => c.char)
  const [inDeck, setInDeck] = useState<{ key: string; chars: string[]; error?: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const reasonId = useId()
  const writableKey = writable.join('')

  // Which of the characters are already in the deck, kept current while the screen is open.
  useEffect(() => {
    let alive = true
    const check = () => {
      Promise.all(writableKey ? [...writableKey].map((c) => deck.has(c).then((has) => (has ? c : ''))) : []).then(
        (found) => {
          if (alive) setInDeck({ key: writableKey, chars: found.filter(Boolean) })
        },
        (error: unknown) => {
          if (alive) setInDeck({ key: writableKey, chars: [], error })
        },
      )
    }
    check()
    const off = deck.subscribe(check)
    return () => {
      alive = false
      off()
    }
  }, [writableKey])

  const known = inDeck?.key === writableKey ? inDeck.chars : null
  const allIn = known !== null && writable.length > 0 && known.length === writable.length
  // The deck cannot be read (private mode, storage blocked): retrying will not help, so say why now.
  const broken = inDeck?.key === writableKey && inDeck.error !== undefined ? deckErrorText(inDeck.error) : null

  const add = async () => {
    if (broken) {
      setMessage({ text: broken, error: true })
      return
    }
    if (busy || writable.length === 0 || allIn) return
    setBusy(true)
    setMessage(null)
    const context = {
      key: entry.key,
      simp: entry.simp,
      pinyin: entry.pinyin,
      vi: firstMeaning(entry.vi.length ? entry.vi : entry.en),
      // A name's capital is the word's, not the character's (中 in 中国): see practiceItem.ts.
      ...(entry.flags.includes('pn') ? { pn: true } : {}),
    }
    try {
      const r = await deck.add(writable.map((char) => ({ char, context })))
      const parts: string[] = []
      if (r.added) parts.push(`Đã thêm ${r.added} chữ vào sổ ôn tập`)
      if (r.existing) parts.push(`${r.existing} chữ đã có sẵn trong sổ`)
      if (r.skipped.length) parts.push(`${r.skipped.join(', ')} chưa có dữ liệu nét viết nên không thêm được`)
      setMessage({ text: `${parts.join('; ') || 'Không có chữ nào được thêm'}.` })
    } catch (e) {
      console.error('[dict] deck.add failed', e)
      setMessage({ text: deckErrorText(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  const reason =
    writable.length === 0
      ? chars.length === 0
        ? 'Mục này không có chữ Hán để luyện viết.'
        : 'Chưa có dữ liệu nét viết cho chữ này nên chưa thêm vào sổ ôn tập được.'
      : (broken ?? (missing.length ? `Chữ ${missing.join(', ')} chưa có dữ liệu nét viết nên sẽ không được thêm.` : null))

  return (
    <div className="dict-add">
      {/* One button throughout, so focus stays on it when it turns into "already in the deck". */}
      <button
        type="button"
        className={allIn ? 'btn btn--wide dict-add__btn--done' : 'btn btn--primary btn--wide'}
        aria-disabled={writable.length === 0 || busy || allIn || !!broken || undefined}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => void add()}
      >
        {allIn ? '✓ Đã có trong sổ ôn tập' : busy ? 'Đang thêm…' : 'Thêm vào sổ ôn tập'}
      </button>
      {allIn && (
        <p className="dict-add__done">
          <a href={DECK_HREF}>Mở sổ ôn tập</a>
        </p>
      )}
      {reason && (
        <p id={reasonId} className="dict-add__reason">
          {reason}
        </p>
      )}
      {!allIn && !broken && writable.length > 0 && (
        <p className="dict-add__what">
          Mỗi chữ thành một thẻ luyện viết ({writable.join(', ')}), kèm từ này làm ngữ cảnh.
        </p>
      )}
      <p className={message?.error ? 'dict-add__msg dict-add__msg--error' : 'dict-add__msg'} role="status">
        {message?.text}
      </p>
    </div>
  )
}
