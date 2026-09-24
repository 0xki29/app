import { useId, useState } from 'react'
import { LiveRegion, type Announcement } from '../app/LiveRegion'
import { leavePractice } from '../app/router'
import { useStrokeData } from '../strokes/useStrokeData'
import type { Mode } from '../workspace/attempt'
import { PracticeWorkspace, RATING_LABEL } from '../workspace/PracticeWorkspace'
import { deck } from './api'
import { usePracticeItem } from './charInfo'
import { deckErrorText, useDeckQuery } from './hooks'

const ALL_MODES: readonly Mode[] = ['observe', 'trace', 'recall']

/**
 * Free practice of any character (#/luyen/<hex>, e.g. from a dictionary entry): all three tabs,
 * rating optional and not recorded (it is not a scheduled review), and "Thêm vào sổ ôn tập".
 */
export function PracticeScreen({ char }: { char: string }) {
  const item = usePracticeItem(char, null)
  return (
    <PracticeWorkspace
      item={item}
      itemKey={char.codePointAt(0) ?? 0}
      modes={ALL_MODES}
      back={{ label: 'Quay lại', onClick: leavePractice }}
      onRated={(rating) => `${char} → ${RATING_LABEL[rating]} (luyện tự do, không tính lịch ôn)`}
      aside={<AddToDeckChip char={char} />}
    />
  )
}

/**
 * "+ Ôn tập": adds the character's writing card; says so when it is in the deck, or why it cannot
 * be (no stroke data, or the browser keeps no data: the chip is then disabled and says why).
 */
function AddToDeckChip({ char }: { char: string }) {
  const inDeck = useDeckQuery(() => deck.has(char), char)
  const stroke = useStrokeData(char)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Announcement | null>(null)
  const reasonId = useId()
  const say = (text: string) => setMessage((m) => ({ id: (m?.id ?? 0) + 1, text }))

  const has = inDeck.status === 'ready' && inDeck.data
  const noStrokes = stroke.status === 'none'
  const broken = inDeck.status === 'error' ? deckErrorText(inDeck.error) : null
  const reason = broken ?? (noStrokes ? 'Chưa có dữ liệu nét viết cho chữ này.' : null)

  const add = async () => {
    if (broken) {
      say(broken)
      return
    }
    if (busy || has || inDeck.status !== 'ready') return
    if (noStrokes) {
      say('Chưa có dữ liệu nét viết cho chữ này nên chưa thêm vào sổ ôn tập được.')
      return
    }
    setBusy(true)
    try {
      const r = await deck.add([{ char }])
      say(r.added ? `Đã thêm ${char} vào sổ ôn tập` : r.existing ? `${char} đã có trong sổ ôn tập` : 'Chưa có dữ liệu nét viết cho chữ này nên chưa thêm vào sổ ôn tập được.')
    } catch (err) {
      console.error('[deck] add failed', err)
      say(deckErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={has ? 'chip chip--done' : 'chip chip--action'}
        aria-disabled={has || busy || !!reason || undefined}
        aria-describedby={reason ? reasonId : undefined}
        aria-label={has ? 'Đã có trong sổ ôn tập' : 'Thêm vào sổ ôn tập'}
        onClick={() => void add()}
      >
        {has ? '✓ Trong sổ' : '+ Ôn tập'}
      </button>
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
      <LiveRegion message={message} />
      {message && (
        <div key={message.id} className="toast toast--auto" aria-hidden="true">
          {message.text}
        </div>
      )}
    </>
  )
}
