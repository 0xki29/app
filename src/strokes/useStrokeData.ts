import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { strokeSource, type StrokeSource, type StrokeStatus } from './strokeData'
import type { StrokeData } from './types'

export interface StrokeDataState {
  /** 'loading' until the file is in; 'none': the character has no stroke data (the font glyph is shown); 'error': it could not be fetched. */
  status: StrokeStatus
  /** Set only when status is 'ready'. */
  data: StrokeData | null
  /** After an error: fetch again. */
  retry: () => void
}

/**
 * Stroke data for `character`, fetched on first use (strokeData.ts) and cached for the page: a
 * character seen before is 'ready' on the first render. Re-renders only when this character's
 * state changes.
 */
export function useStrokeData(character: string, source: StrokeSource = strokeSource): StrokeDataState {
  const getSnapshot = useCallback(() => source.entry(character), [source, character])
  const entry = useSyncExternalStore(source.subscribe, getSnapshot)
  useEffect(() => {
    source.ensure(character)
  }, [source, character])
  const retry = useCallback(() => source.retry(character), [source, character])
  return useMemo(() => ({ status: entry.status, data: entry.data, retry }), [entry, retry])
}
