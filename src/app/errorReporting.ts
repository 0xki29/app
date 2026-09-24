/**
 * Error logging, so a failure on a learner's phone can be traced to a build. There is no server:
 * errors go to the console (remote DevTools on a phone), each with the build that produced it.
 */

/** Vite's entry chunk is named by a content hash (`index-DMx1f2aB.js`), so its name identifies the build. */
function chunkName(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() || url
  } catch {
    return url
  }
}

export const BUILD_INFO: Readonly<{ mode: string; chunk: string }> = Object.freeze({
  mode: import.meta.env.MODE,
  chunk: chunkName(import.meta.url),
})

/** Logs `error` with where it happened (`context`) and the build info. */
export function reportError(context: string, error: unknown, extra: Record<string, unknown> = {}): void {
  const where = typeof navigator === 'undefined' ? {} : { userAgent: navigator.userAgent }
  console.error(`[${context}]`, error, { ...BUILD_INFO, ...where, ...extra })
}

/**
 * Logs uncaught errors and unhandled promise rejections (reportError). Returns the uninstaller.
 * React render errors are caught by ErrorBoundary instead; these are the ones outside React
 * (event handlers, timers, async code).
 */
export function installGlobalErrorHandlers(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onError = (e: Event) => {
    const { error, message, filename, lineno, colno } = e as ErrorEvent
    reportError('uncaught', error ?? message, filename ? { source: `${filename}:${lineno}:${colno}` } : {})
  }
  const onRejection = (e: Event) => reportError('unhandledrejection', (e as PromiseRejectionEvent).reason)
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
