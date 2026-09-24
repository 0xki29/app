import { useEffect, useRef } from 'react'

export interface Announcement {
  text: string
  /** A new id announces again, even the same text. */
  id: number
}

/**
 * One persistent, visually hidden live region. Screen readers announce changes to a live region
 * that already exists, so it stays mounted, and each message is written once, whole: nothing that
 * animates (the score count-up) is inside it. Cleared first, so a repeated text is read again.
 */
export function LiveRegion({ message }: { message: Announcement | null }) {
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = ''
    if (!message) return
    const raf = requestAnimationFrame(() => {
      el.textContent = message.text
    })
    return () => cancelAnimationFrame(raf)
  }, [message])

  return <p ref={ref} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
}
