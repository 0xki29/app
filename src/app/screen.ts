/**
 * Moves focus to a screen's heading when focus is not already on the screen: after a navigation
 * the link that was tapped is gone (focus falls to <body>) or belongs to the navigation bar, and a
 * screen reader would not say that a new screen opened. Focus the screen itself put somewhere (the
 * search box) or the learner moved into it stays. `screen`: the screen's root (default: the
 * heading's <main>).
 */
export function focusLostHeading(heading: HTMLElement | null, screen: Element | null = heading?.closest('main') ?? null): void {
  if (!heading) return
  const active = document.activeElement
  const onScreen = !!active && active !== document.body && document.contains(active) && !!screen?.contains(active)
  if (onScreen) return
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
  heading.focus({ preventScroll: true })
}

/** "学生 xué sheng · Tra cứu · Chinese Notebook": the browser's tab and history list name the screen. */
export function pageTitle(screen: string): string {
  return `${screen} · Chinese Notebook`
}
