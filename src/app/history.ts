import { useCallback, useState } from 'react'

/**
 * What the app keeps in each browser history entry (history.state), so that Back returns to a
 * screen as it was left and in-app "back" links do not pile up entries:
 *   from    the hash this entry was reached from by a link (null: none, or it replaced another)
 *   scroll  how far the page was scrolled (saved shortly after scrolling stops, and before a tap)
 *   ui      small bits of screen state, such as which result lists were expanded
 * The search screen's replaceState for its query keeps the state (SearchScreen).
 */

interface EntryState {
  from?: string | null
  scroll?: number
  ui?: Record<string, unknown>
}

function current(): EntryState {
  const s: unknown = typeof history === 'undefined' ? null : history.state
  return s && typeof s === 'object' ? (s as EntryState) : {}
}

function write(patch: EntryState): void {
  try {
    history.replaceState({ ...current(), ...patch }, '')
  } catch {
    // Browsers limit how often replaceState may run (Safari: 100 per 10 s): losing one save is fine.
  }
}

/** Set by goBackTo when it replaces the current entry: the next one was reached from nowhere left in history. */
let replacing = false

/**
 * The shell calls this once per route change (the entry now shown): a new entry notes the hash it
 * was reached from, one returned to by Back keeps what it had.
 */
export function noteArrival(previousHash: string | null): void {
  if (current().from !== undefined) return
  write({ from: replacing ? null : previousHash })
  replacing = false
}

/**
 * An in-app "back" or "up" link to `href`: the browser's Back when that is where this entry came
 * from (so the phone's Back button does not then reopen the screen just left), otherwise `href`
 * in place of this entry.
 */
export function goBackTo(href: string): void {
  if (current().from === href) {
    history.back()
    return
  }
  replacing = true
  location.replace(href)
}

/** Click handler for a back link: `goBackTo(href)` for a plain click, the link's own behaviour otherwise (new tab…). */
export function backLinkClick(href: string) {
  return (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    goBackTo(href)
  }
}

// ── Scroll position ──────────────────────────────────────────────────────────

let saveTimer: number | undefined

function saveScrollNow(): void {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (current().scroll !== window.scrollY) write({ scroll: window.scrollY })
}

/**
 * Keeps the scroll position in the current entry: shortly after scrolling stops, and at once before
 * a tap or key press that may navigate. Returns the uninstaller.
 */
export function trackScroll(): () => void {
  history.scrollRestoration = 'manual'
  const onScroll = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveScrollNow, 150)
  }
  const flush = () => {
    if (saveTimer !== undefined) saveScrollNow()
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('click', flush, true)
  window.addEventListener('keydown', flush, true)
  return () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('click', flush, true)
    window.removeEventListener('keydown', flush, true)
    window.clearTimeout(saveTimer)
  }
}

/**
 * Scrolls the page where this entry was left: at once when the page is tall enough, else as its
 * content arrives (search results, an entry), for up to 3 s; the learner scrolling or tapping
 * meanwhile stops it. A new entry starts at the top. Returns the canceller.
 */
export function restoreScroll(): () => void {
  // A save still pending belongs to the entry just left: it must not land in this one.
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  const y = current().scroll ?? 0
  window.scrollTo(0, 0)
  if (y <= 0) return () => {}
  let raf = 0
  const until = performance.now() + 3000
  const stop = () => {
    cancelAnimationFrame(raf)
    for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(t, stop, true)
  }
  const step = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.min(y, Math.max(0, max)))
    if (max >= y || performance.now() > until) stop()
    else raf = requestAnimationFrame(step)
  }
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(t, stop, { capture: true, passive: true })
  step()
  return stop
}

// ── Screen state ─────────────────────────────────────────────────────────────

/**
 * useState whose value is also kept in the current history entry under `key`: returning to the
 * entry with Back starts from it (an expanded result list stays expanded). JSON-safe values only.
 */
export function useEntryState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = current().ui?.[key]
    return saved === undefined ? initial : (saved as T)
  })
  const set = useCallback(
    (next: T) => {
      setValue(next)
      write({ ui: { ...current().ui, [key]: next } })
    },
    [key],
  )
  return [value, set]
}
