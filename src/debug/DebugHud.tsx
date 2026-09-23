import { useEffect, useRef, useState } from 'react'
import type { EngineStats, HandwritingEngine } from '../handwriting/HandwritingEngine'
import { detectInputSupport } from '../handwriting/InputController'
import type { ScoreResult } from '../handwriting/scoring'
import { useEngineState } from '../handwriting/useEngineState'
import { commitCounts, totalCommits, useCommitCounter } from './renderStats'

const POLL_MS = 250
const support = detectInputSupport()

/** Last scoring run, as shown in the HUD. */
export interface ScoreDebug {
  result: ScoreResult
  /** Wall time incl. reference preparation. */
  ms: number
  seq: number
}

interface Props {
  engine: HandwritingEngine
  score: ScoreDebug | null
  onClose: () => void
}

/**
 * Debug overlay. Metrics are written straight into a <pre> on a timer — not React state — so the
 * HUD itself adds no React work while a stroke is drawn. Controls re-render only on user change.
 */
export function DebugHud({ engine, score, onClose }: Props) {
  useCommitCounter('DebugHud')
  const { settings } = useEngineState(engine)
  const textRef = useRef<HTMLPreElement>(null)
  const [showControls, setShowControls] = useState(false)

  useEffect(() => {
    let commitsAtStart = 0
    let commitsDuringLastStroke: number | null = null
    const off = engine.onStrokePhase((phase) => {
      if (phase === 'start') commitsAtStart = totalCommits()
      else commitsDuringLastStroke = totalCommits() - commitsAtStart
    })
    const tick = () => {
      if (textRef.current) textRef.current.textContent = formatStats(engine.stats, commitsDuringLastStroke)
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [engine])

  return (
    <aside className="hud" aria-label="Debug HUD">
      <div className="hud__head">
        <strong>Debug HUD</strong>
        <span>
          <button type="button" className="hud__btn" aria-expanded={showControls} onClick={() => setShowControls((v) => !v)}>
            controls {showControls ? '▴' : '▾'}
          </button>
          <button type="button" className="hud__btn" onClick={onClose} aria-label="Đóng HUD">
            ✕
          </button>
        </span>
      </div>
      <pre ref={textRef} className="hud__stats" />
      <pre className="hud__stats hud__score">{formatScore(score)}</pre>
      <div className="hud__controls" hidden={!showControls}>
        <fieldset className="hud__row">
          <legend>Renderer</legend>
          <label>
            <input
              type="radio"
              name="renderer"
              checked={settings.renderer === 'quad'}
              onChange={() => engine.setSettings({ renderer: 'quad' })}
            />
            A · quad
          </label>
          <label>
            <input
              type="radio"
              name="renderer"
              checked={settings.renderer === 'freehand'}
              onChange={() => engine.setSettings({ renderer: 'freehand' })}
            />
            B · freehand
          </label>
        </fieldset>
        <Slider
          label="Width"
          value={settings.strokeWidth}
          min={0.015}
          max={0.07}
          step={0.0025}
          format={(v) => `${(v * 100).toFixed(2)}% box`}
          onChange={(v) => engine.setSettings({ strokeWidth: v })}
        />
        {settings.renderer === 'freehand' && (
          <>
            <Slider
              label="Thinning"
              value={settings.thinning}
              min={0}
              max={0.9}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => engine.setSettings({ thinning: v })}
            />
            <Slider
              label="Streamline"
              value={settings.streamline}
              min={0}
              max={0.9}
              step={0.05}
              format={(v) => `${v.toFixed(2)} (lag ↑)`}
              onChange={(v) => engine.setSettings({ streamline: v })}
            />
          </>
        )}
        <label className="hud__row">
          <input
            type="checkbox"
            checked={settings.predicted}
            disabled={!support.predicted}
            onChange={(e) => engine.setSettings({ predicted: e.target.checked })}
          />
          Predicted events {support.predicted ? '' : '(unsupported here)'}
        </label>
      </div>
    </aside>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="hud__slider">
      <span>
        {label} <em>{format(value)}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

const LEVEL_LABEL = { full: 'Full', partial: 'Partial', unavailable: 'Unavailable' } as const
const n = (v: number | null) => (v === null ? 'N/A' : String(v))
const f2 = (v: number | null) => (v === null ? 'N/A' : v.toFixed(2))

function formatScore(s: ScoreDebug | null): string {
  if (!s) return 'scoring  — (not scored yet)'
  const r = s.result
  const b = r.breakdown
  const d = r.diagnostics
  const w = d.weights
  const missing = Object.entries(d.unavailable).map(([k, why]) => `  ${k}: ${why}`)
  return [
    `scoring  #${s.seq} · engine ${r.engine === 'geometry-v1' ? 'Geometry (heuristic)' : r.engine}`,
    `mode     ${r.mode === 'trace' ? 'Trace' : 'Recall'} · status ${r.status}`,
    `ref data ${LEVEL_LABEL[r.referenceLevel]}`,
    ...r.referenceSource.split(' + ').map((part) => `         ${part}`),
    `Score: ${r.total}  (${r.grade})`,
    `Shape: ${n(b.shape)} · Position: ${n(b.position)} · Length: ${n(b.length)}`,
    `Stroke count: ${n(b.strokeCount)} · Stroke order: ${n(b.strokeOrder)}`,
    `weights  S ${w.shape ?? '–'} · P ${w.position ?? '–'} · L ${w.length ?? '–'} · C ${w.strokeCount ?? '–'}`,
    `raw      precision ${f2(d.precision)} · coverage ${f2(d.coverage)}`,
    `         mean dist ${d.meanDistance === null ? 'N/A' : d.meanDistance.toFixed(3)} box · len ratio ${f2(d.lengthRatio)}`,
    `         strokes ${d.userStrokes} / ${d.referenceStrokes ?? '?'} · ${s.ms.toFixed(1)} ms`,
    ...(missing.length ? ['not scored:', ...missing] : []),
  ].join('\n')
}

function formatStats(s: EngineStats, commitsDuringLastStroke: number | null): string {
  const end = s.drawing ? performance.now() : s.strokeEndMs
  const seconds = s.strokeStartMs > 0 ? Math.max(end - s.strokeStartMs, 1) / 1000 : 0
  const rate = (n: number) => (seconds > 0 ? Math.round(n / seconds) : 0)
  const samplesPerEvent = s.strokeMoveEvents > 0 ? (s.strokeSamples - 1) / s.strokeMoveEvents : 0
  const avgFrame = s.frames > 0 ? s.frameMsSum / s.frames : 0
  const yes = (b: boolean) => (b ? '✓' : '✗')
  const counts = Object.entries(commitCounts).map(([name, n]) => `${name} ${n}`)
  const countLines: string[] = []
  for (let i = 0; i < counts.length; i += 2) countLines.push(`         ${counts.slice(i, i + 2).join(' · ')}`)

  // Lines kept ≤ ~46 chars so the docked panel never scrolls sideways.
  return [
    `state    ${s.drawing ? 'DRAWING' : 'idle'}  (stroke = current or last)`,
    `pointer  ${s.pointerType ?? '—'}  p=${s.pressure.toFixed(2)}  pen seen: ${s.penSeen ? 'yes' : 'no'}`,
    `stroke   ${s.strokePoints} pts · ${s.strokeMoveEvents} ev · ${samplesPerEvent.toFixed(2)} samples/ev`,
    `rate     ${rate(s.strokeMoveEvents)} ev/s · ${rate(s.strokeSamples)} samples/s`,
    `frame    ${s.frames}× · last ${s.lastFrameMs.toFixed(2)} · avg ${avgFrame.toFixed(2)} · max ${s.frameMsMax.toFixed(2)} ms`,
    `in→draw  ${s.inputToDrawMs.toFixed(1)} ms (max ${s.inputToDrawMaxMs.toFixed(1)}) · JS-side only`,
    `ink      ${s.strokeCount} strokes`,
    `canvas   ${s.cssSize.toFixed(1)} css px · ${s.backingSize}² backing`,
    `dpr      ${s.dpr.toFixed(2)} used · device ${s.deviceDpr.toFixed(2)} · cap 3`,
    `support  coalesced ${yes(s.supportsCoalesced)} · predicted ${yes(s.supportsPredicted)} · desync ${yes(s.desynchronized)}`,
    `React    commits during last stroke: ${commitsDuringLastStroke ?? '—'}`,
    ...countLines,
  ].join('\n')
}
