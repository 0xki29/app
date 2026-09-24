import { useSyncExternalStore } from 'react'
import type { EngineSnapshot, HandwritingEngine } from './HandwritingEngine'

/**
 * Commit-level engine state (canUndo, strokeCount, inkRevision, inputEnabled, settings,
 * canvasError). Never changes per pointer sample, nor when a stroke starts or is dropped.
 */
export function useEngineState(engine: HandwritingEngine): EngineSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}
