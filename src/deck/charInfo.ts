import { useEffect, useState } from 'react'
import { dictionary } from '../dict/client'
import type { CharInfo } from '../dict/types'
import { practiceInfo, type PracticeContext, type PracticeItem } from '../workspace/practiceItem'

/**
 * A character's dictionary information for its practice prompt (dictionary.charInfo, in the
 * dictionary's worker), kept for the page: a session asks for the next card's while the current one
 * is on screen, so the prompt is usually ready when the card is. A failure (no data built, the
 * dictionary not loading) is not kept: the next ask tries again.
 */

export interface CharInfoSource {
  charInfo(ch: string): Promise<CharInfo | null>
}

type Known = { info: CharInfo | null }

const known = new Map<string, Known>()
const pending = new Map<string, Promise<CharInfo | null>>()

export function loadCharInfo(char: string, source: CharInfoSource = dictionary): Promise<CharInfo | null> {
  const k = known.get(char)
  if (k) return Promise.resolve(k.info)
  let p = pending.get(char)
  if (!p) {
    p = source.charInfo(char).then(
      (info) => {
        pending.delete(char)
        known.set(char, { info })
        return info
      },
      (err: unknown) => {
        pending.delete(char)
        throw err
      },
    )
    pending.set(char, p)
  }
  return p
}

/** Asks for a character's information ahead of time (errors are left for when it is shown). */
export function prefetchCharInfo(char: string): void {
  loadCharInfo(char).catch(() => {})
}

type State = { char: string; status: PracticeItem['infoStatus']; info: CharInfo | null }

/** The practice item for `char` (and the word it was learned in): its prompt fills in when the dictionary answers. */
export function usePracticeItem(char: string, context: PracticeContext | null): PracticeItem {
  const [state, setState] = useState<State>(() => initial(char))

  useEffect(() => {
    let alive = true
    loadCharInfo(char).then(
      (info) => {
        if (alive) setState({ char, status: info ? 'ready' : 'none', info })
      },
      (err: unknown) => {
        console.warn(`[practice] no dictionary information for ${char}`, err)
        if (alive) setState({ char, status: 'none', info: null })
      },
    )
    return () => {
      alive = false
    }
  }, [char])

  const current = state.char === char ? state : initial(char)
  const info = practiceInfo(current.info, char, context)
  return { char, info, infoStatus: current.status === 'ready' && !info ? 'none' : current.status, context }
}

function initial(char: string): State {
  const k = known.get(char)
  return k ? { char, status: k.info ? 'ready' : 'none', info: k.info } : { char, status: 'loading', info: null }
}
