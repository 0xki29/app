import { useSyncExternalStore } from 'react'
import type { EngineSnapshot, HandwritingEngine } from './HandwritingEngine'

/** Commit-level engine state (canUndo, strokeCount, settings). Never changes per pointer sample. */
export function useEngineState(engine: HandwritingEngine): EngineSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}
