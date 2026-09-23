import { memo, useEffect, useRef } from 'react'
import { useCommitCounter } from '../debug/renderStats'
import type { HandwritingEngine } from './HandwritingEngine'

/**
 * observe — reference shown solid, for looking (input is disabled by the caller)
 * trace   — faint reference under the ink
 * hidden  — no reference (recall)
 * reveal  — translucent reference on top of the ink, for self-assessment
 */
export type ReferenceMode = 'observe' | 'trace' | 'hidden' | 'reveal'

interface Props {
  engine: HandwritingEngine
  char: string
  lang: string
  referenceMode: ReferenceMode
}

/**
 * DOM shell for the engine. Mounts once per engine; re-renders only when the character or
 * reference mode changes. Drawing happens entirely inside the engine.
 */
export const HandwritingCanvas = memo(function HandwritingCanvas({ engine, char, lang, referenceMode }: Props) {
  useCommitCounter('Canvas')
  const boxRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const tailRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const box = boxRef.current
    const staticCanvas = staticRef.current
    const liveCanvas = liveRef.current
    const tailCanvas = tailRef.current
    if (!box || !staticCanvas || !liveCanvas || !tailCanvas) return
    return engine.attach({ box, staticCanvas, liveCanvas, tailCanvas })
  }, [engine])

  return (
    <div ref={boxRef} className="hw-box" data-ref={referenceMode} role="img" aria-label={`Ô viết chữ ${char}`}>
      <Grid />
      <div className="hw-ref hw-ref--under" lang={lang} aria-hidden="true">
        {char}
      </div>
      <canvas ref={staticRef} className="hw-layer" />
      <canvas ref={liveRef} className="hw-layer" />
      <canvas ref={tailRef} className="hw-layer" />
      <div className="hw-ref hw-ref--over" lang={lang} aria-hidden="true">
        {char}
      </div>
    </div>
  )
})

/** 米字格 practice grid. */
function Grid() {
  return (
    <svg className="hw-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="50" y1="0" x2="50" y2="100" />
      <line x1="0" y1="50" x2="100" y2="50" />
      <line x1="0" y1="0" x2="100" y2="100" className="hw-grid__diag" />
      <line x1="100" y1="0" x2="0" y2="100" className="hw-grid__diag" />
    </svg>
  )
}
