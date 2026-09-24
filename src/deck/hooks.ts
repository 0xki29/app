import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import { DataUnavailableError } from '../strokes/strokeData'
import { deck } from './api'
import { DeckImportError, DeckOutdatedError, DeckStorageError } from './deck'

export type Query<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown }

/** Re-renders whenever the deck changes (here or in another tab). */
export function useDeckVersion(): number {
  return useSyncExternalStore(deck.subscribe, deck.version)
}

/**
 * The result of a deck read, read again whenever the deck changes or `key` does. The previous
 * result stays on screen while the next one loads, so a change never flashes a loading state.
 */
export function useDeckQuery<T>(query: () => Promise<T>, key: unknown = null): Query<T> {
  const version = useDeckVersion()
  const [state, setState] = useState<Query<T>>({ status: 'loading' })
  const run = useEffectEvent(query)
  useEffect(() => {
    let alive = true
    run().then(
      (data) => {
        if (alive) setState({ status: 'ready', data })
      },
      (error: unknown) => {
        if (alive) setState({ status: 'error', error })
      },
    )
    return () => {
      alive = false
    }
  }, [version, key])
  return state
}

/** A deck failure as the learner reads it (the deck's and the data's own errors are written for them). */
export function deckErrorText(error: unknown): string {
  if (error instanceof DeckStorageError || error instanceof DeckImportError || error instanceof DeckOutdatedError || error instanceof DataUnavailableError)
    return error.message
  return 'Không đọc hoặc ghi được sổ ôn tập. Hãy thử lại, hoặc tải lại trang.'
}

/** Only a reload helps: another tab runs a newer version of the app. */
export function needsReload(error: unknown): boolean {
  return error instanceof DeckOutdatedError
}
