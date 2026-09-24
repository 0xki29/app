import type { ReferenceMode } from '../handwriting/HandwritingCanvas'
import type { ScoreResult } from '../handwriting/scoring'
import type { StrokeEnd } from '../handwriting/types'
import type { StrokeCheck } from '../strokes/strokeCheck'

/**
 * The practice flow as a pure state machine: which character, which mode, and where the current
 * attempt is. The workspace renders from it and drives the engine from it; nothing here touches
 * the DOM, so every transition is unit-tested (attempt.test.ts).
 *
 * An attempt is one go at writing the character in one mode. Going anywhere — another character,
 * another mode, "Viết lại", the tab already active tapped again once the attempt is scored — starts
 * a new attempt, and the workspace resets the box whenever `attemptId` changes. So ink, verdict
 * colors and results can never outlive the attempt they belong to, and an answer async scoring
 * brings back for an older attempt is dropped. The active tab tapped while the attempt is still
 * being written or scored does nothing: the learner's ink stays (a reset cannot be undone).
 */

export type Mode = 'observe' | 'trace' | 'recall'
export type Rating = 'correct' | 'close' | 'wrong'

/** writing → scoring (async) → scored → revealed (recall only). */
export type Phase = 'writing' | 'scoring' | 'scored' | 'revealed'

/** What scoring brought back for an attempt. */
export interface ScoredAttempt {
  result: ScoreResult
  /** Stroke-by-stroke verdicts (characters with stroke data). */
  check: StrokeCheck | null
  /** How each scored stroke ended (Stroke.end), to flag strokes something cut short. */
  ends: readonly (StrokeEnd | undefined)[]
  /** Wall time incl. reference preparation, for the debug HUD. */
  ms: number
}

export interface PracticeState {
  /** Position in the character list. */
  index: number
  mode: Mode
  phase: Phase
  /** Identifies the attempt; a new one starts on every go / rewrite (see above). */
  attemptId: number
  /** The ink is fading out before a rewrite starts the next attempt. */
  fading: boolean
  /**
   * Recall: this character's answer has been shown after a recall attempt, and not rated since.
   * Writing it "from memory" again is then no longer recall, so the learner is told, and the rating
   * says so.
   */
  peeked: boolean
  /** The characters (indices) whose answer Recall has shown and that have not been rated since. */
  revealed: readonly number[]
  /** The latest scoring, kept after its attempt ends (the debug HUD shows it). */
  last: { attemptId: number; seq: number; attempt: ScoredAttempt } | null
}

export type PracticeAction =
  | { type: 'go'; index: number; mode: Mode }
  | { type: 'score' }
  | { type: 'scored'; attemptId: number; attempt: ScoredAttempt }
  | { type: 'scoreFailed'; attemptId: number }
  | { type: 'reveal' }
  /** The learner rated the revealed recall: on to `index`, in observe. */
  | { type: 'rate'; index: number }
  /** "Viết lại": `fade` first fades the ink out (then 'faded' starts the attempt), else at once. */
  | { type: 'rewrite'; fade: boolean }
  | { type: 'faded'; attemptId: number }

export const INITIAL_PRACTICE: PracticeState = {
  index: 0,
  mode: 'observe',
  phase: 'writing',
  attemptId: 0,
  fading: false,
  peeked: false,
  revealed: [],
  last: null,
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'go': {
      const same = action.index === state.index && action.mode === state.mode
      // Recall after the answer was shown is locked: tapping "Nhớ lại" again must not hand back an
      // empty box to "recall" what is still on screen. The learner rates, or goes elsewhere.
      if (same && isRecallLocked(state)) return state
      // The tab already active, tapped while its attempt is written or scored: nothing to start over.
      if (same && (state.phase === 'writing' || state.phase === 'scoring')) return state
      return newAttempt(state, action.index, action.mode)
    }
    case 'rate': {
      if (state.phase !== 'revealed') return state
      // Rated: this character's recall is over, and the next one starts afresh.
      const revealed = state.revealed.filter((i) => i !== state.index)
      return newAttempt({ ...state, revealed }, action.index, 'observe')
    }
    case 'score':
      return canScore(state) ? { ...state, phase: 'scoring' } : state
    case 'scored': {
      if (action.attemptId !== state.attemptId || state.phase !== 'scoring') return state
      // Recall with stroke data shows the reference and the marks at once: nothing left to reveal.
      const shown = state.mode === 'recall' && action.attempt.check !== null
      const scored: PracticeState = {
        ...state,
        phase: 'scored',
        last: { attemptId: state.attemptId, seq: (state.last?.seq ?? 0) + 1, attempt: action.attempt },
      }
      return shown ? revealAnswer(scored) : scored
    }
    case 'scoreFailed':
      if (action.attemptId !== state.attemptId || state.phase !== 'scoring') return state
      return { ...state, phase: 'writing' }
    case 'reveal':
      if (state.mode !== 'recall' || state.phase !== 'scored') return state
      return revealAnswer(state)
    case 'rewrite':
      // Only a scored attempt has a "Viết lại"; a revealed recall is locked (see 'go').
      if (state.phase !== 'scored' || state.fading) return state
      return action.fade ? { ...state, fading: true } : newAttempt(state, state.index, state.mode)
    case 'faded':
      if (action.attemptId !== state.attemptId || !state.fading) return state
      return newAttempt(state, state.index, state.mode)
  }
}

/** The answer is on screen: this character counts as peeked until it is rated, wherever the learner goes. */
function revealAnswer(state: PracticeState): PracticeState {
  const revealed = state.revealed.includes(state.index) ? state.revealed : [...state.revealed, state.index]
  return { ...state, phase: 'revealed', peeked: true, revealed }
}

function newAttempt(state: PracticeState, index: number, mode: Mode): PracticeState {
  const peeked = state.revealed.includes(index)
  return { ...state, index, mode, phase: 'writing', attemptId: state.attemptId + 1, fading: false, peeked }
}

/** "Chấm điểm" applies: something to write in, not already scoring or scored. */
export function canScore(s: PracticeState): boolean {
  return s.mode !== 'observe' && s.phase === 'writing' && !s.fading
}

/** The box takes ink only while an attempt is being written. */
export function acceptsInput(s: PracticeState): boolean {
  return canScore(s)
}

export function isRecallLocked(s: PracticeState): boolean {
  return s.mode === 'recall' && s.phase === 'revealed'
}

/** The result of the current attempt, once scored; null while writing, scoring, or after moving on. */
export function currentResult(s: PracticeState): { seq: number; attempt: ScoredAttempt } | null {
  if (s.phase !== 'scored' && s.phase !== 'revealed') return null
  return s.last && s.last.attemptId === s.attemptId ? s.last : null
}

/** How the box shows the reference (see ReferenceMode). */
export function referenceView(s: PracticeState): ReferenceMode {
  if (s.mode !== 'recall') return s.mode
  if (s.phase !== 'revealed') return 'hidden'
  // With stroke data the review draws the reference under the ink with the marks; without, the
  // font glyph fades in over it.
  return currentResult(s)?.attempt.check ? 'review' : 'reveal'
}

/** Whether the learner may see which character it is (Recall hides it until the answer is shown). */
export function showsCharacter(s: PracticeState): boolean {
  return s.mode !== 'recall' || s.phase === 'revealed'
}

/** Where rating an item leads: the next character, from the start after the last. */
export function nextIndex(index: number, count: number): { index: number; wrapped: boolean } {
  const wrapped = index + 1 >= count
  return { index: wrapped ? 0 : index + 1, wrapped }
}
