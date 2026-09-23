import { useEffect } from 'react'

/**
 * React commit counters per component. The debug HUD uses them to show that the tree stays idle
 * while a stroke is being drawn. (Dev StrictMode adds one extra count per component on mount.)
 */
export const commitCounts: Record<string, number> = {}

export function useCommitCounter(name: string): void {
  useEffect(() => {
    commitCounts[name] = (commitCounts[name] ?? 0) + 1
  })
}

export function totalCommits(): number {
  let total = 0
  for (const name in commitCounts) total += commitCounts[name] ?? 0
  return total
}
