import { useLayoutEffect } from 'react'

/**
 * Locks the page to the viewport while a screen that owns the whole viewport is mounted (the
 * writing workspace): no page scroll, no rubber-band overscroll, no pull-to-refresh — a stroke must
 * never move the page. Other screens (a dictionary, lists) scroll normally. See `html[data-lock]`
 * in styles.css. Set before paint, so the page never shows a scrollbar for a frame.
 */
export function useViewportLock(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.lock = ''
    return () => {
      delete root.dataset.lock
    }
  }, [])
}
