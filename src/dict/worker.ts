import { DictEngine } from './engine'
import type { FromWorker, ToWorker } from './protocol'
import { idbSnapshotStore } from './snapshotStore'

/**
 * The dictionary worker (a module worker; see client.ts). All of the dictionary's loading, index
 * building and searching happen here, off the page's main thread.
 */

/** The worker global, typed by hand: the project's lib is DOM, which clashes with WebWorker. */
const scope = self as unknown as {
  postMessage(msg: FromWorker): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}

/** A task, not a microtask: queued messages (a new search) run before building continues. */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(null)
  })
}

async function sha256(data: ArrayBuffer): Promise<string | null> {
  // crypto.subtle only exists in secure contexts (https, localhost): not on a LAN IP in dev.
  if (!globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const engine = new DictEngine(
  {
    fetch: (input, init) => fetch(input, init),
    sha256,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    yieldNow,
    now: () => performance.now(),
    store: idbSnapshotStore(),
    warn: (...args) => console.warn(...args),
    info: (...args) => console.info(...args),
  },
  (msg: FromWorker) => scope.postMessage(msg),
)

scope.onmessage = (e) => engine.handle(e.data)
