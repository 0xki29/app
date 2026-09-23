import { useCallback, useEffect, useState } from 'react'
import { langOf, scriptLabel, TEST_CHARS } from '../data/testChars'
import { DebugHud } from '../debug/DebugHud'
import { useCommitCounter } from '../debug/renderStats'
import { HandwritingCanvas, type ReferenceMode } from '../handwriting/HandwritingCanvas'
import { HandwritingEngine } from '../handwriting/HandwritingEngine'
import { Controls } from './Controls'

export type Mode = 'observe' | 'trace' | 'recall'
export type Rating = 'correct' | 'close' | 'wrong'

const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'observe', label: 'Xem' },
  { id: 'trace', label: 'Tô theo' },
  { id: 'recall', label: 'Nhớ lại' },
]

const RATING_LABEL: Record<Rating, string> = { correct: 'Đúng', close: 'Gần đúng', wrong: 'Sai' }

const params = new URLSearchParams(window.location.search)
const debugAvailable = import.meta.env.DEV || params.has('debug')

export function WorkspaceScreen() {
  useCommitCounter('Workspace')
  const [engine] = useState(() => new HandwritingEngine({ desynchronized: params.get('desync') !== '0' }))
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('observe')
  const [revealed, setRevealed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [hudOpen, setHudOpen] = useState(() => params.get('debug') === '1')

  const item = TEST_CHARS[index]
  const count = TEST_CHARS.length

  // Every character/mode gets a fresh box.
  useEffect(() => {
    engine.reset()
  }, [engine, index, mode])

  useEffect(() => {
    engine.setInputEnabled(mode !== 'observe' && !revealed)
  }, [engine, mode, revealed])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(id)
  }, [toast])

  const go = useCallback((nextIndex: number, nextMode: Mode) => {
    setIndex(nextIndex)
    setMode(nextMode)
    setRevealed(false)
  }, [])

  const onPrimary = () => {
    if (mode === 'observe') go(index, 'trace')
    else if (mode === 'trace') go(index, 'recall')
    else setRevealed(true)
  }

  const onRate = (rating: Rating) => {
    console.log('[rating]', { char: item.char, rating, ink: engine.getInk() })
    const wrapped = index + 1 >= count
    setToast(`${item.char} → ${RATING_LABEL[rating]}${wrapped ? ' · quay lại chữ đầu' : ''}`)
    go(wrapped ? 0 : index + 1, 'observe')
  }

  const referenceMode: ReferenceMode =
    mode === 'observe' ? 'observe' : mode === 'trace' ? 'trace' : revealed ? 'reveal' : 'hidden'
  const script = scriptLabel(item)
  const showChar = mode !== 'recall' || revealed

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
            {mode === 'recall' && !revealed
              ? 'Viết chữ này từ trí nhớ'
              : [script, mode === 'observe' ? item.note : null].filter(Boolean).join(' · ')}
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
        <HandwritingCanvas engine={engine} char={item.char} lang={langOf(item)} referenceMode={referenceMode} />
      </main>

      <Controls engine={engine} mode={mode} revealed={revealed} onPrimary={onPrimary} onRate={onRate} />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {hudOpen && <DebugHud engine={engine} onClose={() => setHudOpen(false)} />}
    </div>
  )
}
