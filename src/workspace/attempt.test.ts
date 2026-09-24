import { describe, expect, it } from 'vitest'
import type { ScoreResult } from '../handwriting/scoring'
import type { StrokeCheck } from '../strokes/strokeCheck'
import {
  acceptsInput,
  canScore,
  currentResult,
  INITIAL_PRACTICE,
  isRecallLocked,
  nextIndex,
  practiceReducer,
  referenceView,
  showsCharacter,
  type Mode,
  type PracticeAction,
  type PracticeState,
  type ScoredAttempt,
} from './attempt'

const result = { status: 'scored', total: 90 } as ScoreResult
const check = { user: [], reference: [], missing: [], referenceToInk: null } as StrokeCheck
const withCheck: ScoredAttempt = { result, check, ends: [], ms: 1 }
const withoutCheck: ScoredAttempt = { result, check: null, ends: [], ms: 1 }

function run(state: PracticeState, ...actions: PracticeAction[]): PracticeState {
  return actions.reduce(practiceReducer, state)
}

const at = (index: number, mode: Mode) => run(INITIAL_PRACTICE, { type: 'go', index, mode })

/** Scores the current attempt with `attempt`. */
function scoreWith(state: PracticeState, attempt: ScoredAttempt): PracticeState {
  const scoring = practiceReducer(state, { type: 'score' })
  return practiceReducer(scoring, { type: 'scored', attemptId: scoring.attemptId, attempt })
}

describe('practiceReducer: attempts', () => {
  it('starts on the first character in observe, writing', () => {
    expect(INITIAL_PRACTICE).toMatchObject({ index: 0, mode: 'observe', phase: 'writing', fading: false })
  })

  it('starts a new attempt when the tab that is already active is tapped once the attempt is scored (A1)', () => {
    const trace = at(0, 'trace')
    const scored = scoreWith(trace, withoutCheck)
    expect(scored.phase).toBe('scored')
    const again = practiceReducer(scored, { type: 'go', index: 0, mode: 'trace' })
    expect(again.attemptId).toBe(scored.attemptId + 1)
    expect(again.phase).toBe('writing')
    expect(currentResult(again)).toBeNull()
    expect(acceptsInput(again)).toBe(true)
  })

  it('ignores the tab that is already active while its attempt is written or scored: the ink stays (F1)', () => {
    const trace = at(0, 'trace')
    expect(practiceReducer(trace, { type: 'go', index: 0, mode: 'trace' })).toBe(trace)
    const scoring = practiceReducer(trace, { type: 'score' })
    expect(practiceReducer(scoring, { type: 'go', index: 0, mode: 'trace' })).toBe(scoring)
    const recall = at(0, 'recall')
    expect(practiceReducer(recall, { type: 'go', index: 0, mode: 'recall' })).toBe(recall)
  })

  it('ignores "Xem" tapped again: the stroke-order playback keeps its place (F2)', () => {
    const observe = at(1, 'observe')
    expect(practiceReducer(observe, { type: 'go', index: 1, mode: 'observe' })).toBe(observe)
  })

  it('starts a new attempt on a character or mode change', () => {
    const s = at(0, 'trace')
    expect(practiceReducer(s, { type: 'go', index: 1, mode: 'trace' }).attemptId).toBe(s.attemptId + 1)
    expect(practiceReducer(s, { type: 'go', index: 0, mode: 'recall' }).attemptId).toBe(s.attemptId + 1)
  })

  it('drops a scoring answer for an older attempt', () => {
    const trace = at(0, 'trace')
    const scoring = practiceReducer(trace, { type: 'score' })
    const moved = practiceReducer(scoring, { type: 'go', index: 0, mode: 'recall' })
    const late = practiceReducer(moved, { type: 'scored', attemptId: scoring.attemptId, attempt: withoutCheck })
    expect(late).toBe(moved)
    expect(practiceReducer(moved, { type: 'scoreFailed', attemptId: scoring.attemptId })).toBe(moved)
  })

  it('scores only while writing, never in observe or twice', () => {
    expect(practiceReducer(INITIAL_PRACTICE, { type: 'score' })).toBe(INITIAL_PRACTICE)
    const scoring = practiceReducer(at(0, 'trace'), { type: 'score' })
    expect(scoring.phase).toBe('scoring')
    expect(canScore(scoring)).toBe(false)
    expect(acceptsInput(scoring)).toBe(false)
    expect(practiceReducer(scoring, { type: 'score' })).toBe(scoring)
  })

  it('goes back to writing when scoring fails, keeping the ink (same attempt)', () => {
    const scoring = practiceReducer(at(0, 'trace'), { type: 'score' })
    const failed = practiceReducer(scoring, { type: 'scoreFailed', attemptId: scoring.attemptId })
    expect(failed.phase).toBe('writing')
    expect(failed.attemptId).toBe(scoring.attemptId)
  })

  it('keeps the last scoring for the HUD but not as the current result once moved on', () => {
    const scored = scoreWith(at(0, 'trace'), withoutCheck)
    expect(currentResult(scored)?.attempt).toBe(withoutCheck)
    const moved = practiceReducer(scored, { type: 'go', index: 1, mode: 'trace' })
    expect(moved.last?.attempt).toBe(withoutCheck)
    expect(currentResult(moved)).toBeNull()
  })

  it('numbers results so each one is shown (and animated) once', () => {
    const first = scoreWith(at(0, 'trace'), withoutCheck)
    const second = scoreWith(practiceReducer(first, { type: 'rewrite', fade: false }), withoutCheck)
    expect(second.last!.seq).toBe(first.last!.seq + 1)
  })
})

describe('practiceReducer: rewrite', () => {
  it('fades first, then starts a new attempt on the same character and mode', () => {
    const scored = scoreWith(at(2, 'trace'), withoutCheck)
    const fading = practiceReducer(scored, { type: 'rewrite', fade: true })
    expect(fading).toMatchObject({ fading: true, attemptId: scored.attemptId })
    expect(acceptsInput(fading)).toBe(false)
    const fresh = practiceReducer(fading, { type: 'faded', attemptId: fading.attemptId })
    expect(fresh).toMatchObject({ index: 2, mode: 'trace', phase: 'writing', fading: false })
    expect(fresh.attemptId).toBe(scored.attemptId + 1)
  })

  it('starts at once without the fade (reduced motion)', () => {
    const scored = scoreWith(at(0, 'trace'), withoutCheck)
    const fresh = practiceReducer(scored, { type: 'rewrite', fade: false })
    expect(fresh.phase).toBe('writing')
    expect(fresh.attemptId).toBe(scored.attemptId + 1)
  })

  it('ignores a fade that ends after the learner went elsewhere, and a second tap', () => {
    const fading = practiceReducer(scoreWith(at(0, 'trace'), withoutCheck), { type: 'rewrite', fade: true })
    expect(practiceReducer(fading, { type: 'rewrite', fade: true })).toBe(fading)
    const moved = practiceReducer(fading, { type: 'go', index: 1, mode: 'trace' })
    expect(moved.fading).toBe(false)
    expect(practiceReducer(moved, { type: 'faded', attemptId: fading.attemptId })).toBe(moved)
  })

  it('does nothing while writing', () => {
    const trace = at(0, 'trace')
    expect(practiceReducer(trace, { type: 'rewrite', fade: false })).toBe(trace)
  })
})

describe('practiceReducer: recall', () => {
  it('with stroke data, shows the answer and the marks at once', () => {
    const revealed = scoreWith(at(3, 'recall'), withCheck)
    expect(revealed.phase).toBe('revealed')
    expect(revealed.peeked).toBe(true)
    expect(referenceView(revealed)).toBe('review')
    expect(showsCharacter(revealed)).toBe(true)
  })

  it('without stroke data, waits for "Hiện mẫu"', () => {
    const scored = scoreWith(at(3, 'recall'), withoutCheck)
    expect(scored.phase).toBe('scored')
    expect(referenceView(scored)).toBe('hidden')
    expect(showsCharacter(scored)).toBe(false)
    const revealed = practiceReducer(scored, { type: 'reveal' })
    expect(revealed.phase).toBe('revealed')
    expect(revealed.peeked).toBe(true)
    expect(referenceView(revealed)).toBe('reveal')
  })

  it('is locked once the answer is shown: tapping "Nhớ lại" again changes nothing (A1)', () => {
    const revealed = scoreWith(at(3, 'recall'), withCheck)
    expect(isRecallLocked(revealed)).toBe(true)
    expect(practiceReducer(revealed, { type: 'go', index: 3, mode: 'recall' })).toBe(revealed)
    expect(practiceReducer(revealed, { type: 'rewrite', fade: false })).toBe(revealed)
    expect(acceptsInput(revealed)).toBe(false)
  })

  it('lets the learner leave a revealed recall, and remembers the peek for this character', () => {
    const revealed = scoreWith(at(3, 'recall'), withCheck)
    const trace = practiceReducer(revealed, { type: 'go', index: 3, mode: 'trace' })
    expect(trace.peeked).toBe(true)
    const back = practiceReducer(trace, { type: 'go', index: 3, mode: 'recall' })
    expect(back).toMatchObject({ mode: 'recall', phase: 'writing', peeked: true })
    expect(referenceView(back)).toBe('hidden')
    expect(practiceReducer(back, { type: 'go', index: 4, mode: 'recall' }).peeked).toBe(false)
  })

  it('keeps the peek through another character and back, until the character is rated (F3)', () => {
    const revealed = scoreWith(at(3, 'recall'), withCheck)
    const next = practiceReducer(revealed, { type: 'go', index: 4, mode: 'recall' })
    expect(next.peeked).toBe(false)
    const back = practiceReducer(next, { type: 'go', index: 3, mode: 'recall' })
    expect(back).toMatchObject({ index: 3, mode: 'recall', phase: 'writing', peeked: true })
    // Rated: on to the next character in observe, and this one's recall starts afresh next time.
    const again = scoreWith(back, withCheck)
    const rated = practiceReducer(again, { type: 'rate', index: 4 })
    expect(rated).toMatchObject({ index: 4, mode: 'observe', phase: 'writing', peeked: false })
    expect(rated.attemptId).toBe(again.attemptId + 1)
    expect(practiceReducer(rated, { type: 'go', index: 3, mode: 'recall' }).peeked).toBe(false)
  })

  it('rates only a revealed recall', () => {
    const trace = at(0, 'trace')
    expect(practiceReducer(trace, { type: 'rate', index: 1 })).toBe(trace)
  })

  it('does not reveal outside recall or before scoring', () => {
    const trace = scoreWith(at(0, 'trace'), withoutCheck)
    expect(practiceReducer(trace, { type: 'reveal' })).toBe(trace)
    const writing = at(0, 'recall')
    expect(practiceReducer(writing, { type: 'reveal' })).toBe(writing)
  })

  it('hides the character while recalling', () => {
    const recall = at(1, 'recall')
    expect(showsCharacter(recall)).toBe(false)
    expect(referenceView(recall)).toBe('hidden')
    expect(showsCharacter(at(1, 'trace'))).toBe(true)
    expect(referenceView(at(1, 'trace'))).toBe('trace')
    expect(referenceView(at(1, 'observe'))).toBe('observe')
  })
})

describe('nextIndex', () => {
  it('moves on, and back to the first after the last', () => {
    expect(nextIndex(0, 5)).toEqual({ index: 1, wrapped: false })
    expect(nextIndex(4, 5)).toEqual({ index: 0, wrapped: true })
  })
})
