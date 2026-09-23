/** JS-driven motion (count-up, delayed clears) must honor the same setting as the CSS. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
