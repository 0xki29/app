const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** JS-driven motion (count-up, delayed clears) must honor the same setting as the CSS. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches
}

/** Calls `onChange` when the reduced-motion setting changes; returns the unsubscribe. */
export function watchReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
