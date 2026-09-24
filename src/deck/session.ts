import type { Mode } from '../workspace/attempt'
import type { CardContext, ReviewMode, SelfRating } from './types'

/**
 * A study session as a pure state machine (unit-tested in session.test.ts): which card is on
 * screen, what comes next, and what was rated. The queue is fixed when the session starts — the due
 * reviews (oldest due first), then the day's new cards (deck.today()). A new card is studied
 * Xem → Tô theo → Nhớ lại, a review only Nhớ lại; each ends with the learner's self-rating.
 *
 * "Sai" brings the card back later in the same session, after REQUEUE_GAP other cards (or last,
 * when fewer are left), as a Recall (FSRS has it in a learning step, due within minutes). A card
 * comes back at most MAX_REQUEUES times; after that it waits for its FSRS due time. One that comes
 * back straight away (no other card left) starts peeked: the answer was on screen a moment ago, so
 * the prompt says so and the rating is logged as peeked.
 */

export const REQUEUE_GAP = 3
export const MAX_REQUEUES = 2

/** One card on screen: `turn` numbers every appearance, a re-queued card included. */
export interface SessionTurn {
  turn: number
  cardId: string
  char: string
  context: CardContext | null
  mode: ReviewMode
  /** Re-queued with no other card in between: its answer was just shown. */
  peeked?: boolean
}

export interface SessionResult {
  turn: number
  cardId: string
  char: string
  rating: SelfRating
  mode: ReviewMode
}

export interface SessionState {
  /** On screen; null once the session has ended. */
  current: SessionTurn | null
  upcoming: readonly SessionTurn[]
  results: readonly SessionResult[]
  /** Times each card was re-queued. */
  requeued: Readonly<Record<string, number>>
  nextTurn: number
  /** 'done': every card was rated; 'quit': the learner stopped early. */
  ended: 'done' | 'quit' | null
}

export type SessionAction = { type: 'rated'; turn: number; rating: SelfRating } | { type: 'quit' }

export interface SessionCard {
  cardId: string
  char: string
  context: CardContext | null
  flow: 'new' | 'review'
}

export function startSession(cards: readonly SessionCard[]): SessionState {
  const turns = cards.map((c, i): SessionTurn => ({ turn: i + 1, cardId: c.cardId, char: c.char, context: c.context, mode: c.flow }))
  return {
    current: turns[0] ?? null,
    upcoming: turns.slice(1),
    results: [],
    requeued: {},
    nextTurn: turns.length + 1,
    ended: turns.length ? null : 'done',
  }
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'rated': {
      const cur = state.current
      // Only the card on screen can be rated, once (a late or repeated tap changes nothing).
      if (!cur || action.turn !== cur.turn) return state
      const results = [...state.results, { turn: cur.turn, cardId: cur.cardId, char: cur.char, rating: action.rating, mode: cur.mode }]
      let upcoming = state.upcoming
      let { requeued, nextTurn } = state
      const times = requeued[cur.cardId] ?? 0
      if (action.rating === 'wrong' && times < MAX_REQUEUES) {
        const at = Math.min(REQUEUE_GAP, upcoming.length)
        const again: SessionTurn = { ...cur, turn: nextTurn++, mode: 'again', ...(at === 0 ? { peeked: true } : {}) }
        upcoming = [...upcoming.slice(0, at), again, ...upcoming.slice(at)]
        requeued = { ...requeued, [cur.cardId]: times + 1 }
      }
      const [next = null, ...rest] = upcoming
      return { ...state, current: next, upcoming: rest, results, requeued, nextTurn, ended: next ? null : 'done' }
    }
    case 'quit':
      if (!state.current) return state
      return { ...state, current: null, upcoming: [], ended: 'quit' }
  }
}

/** The tabs a turn offers, in order; it starts on the first. */
export function modesFor(mode: ReviewMode): readonly Mode[] {
  return mode === 'new' ? NEW_MODES : RECALL_ONLY
}

const NEW_MODES: readonly Mode[] = ['observe', 'trace', 'recall']
const RECALL_ONLY: readonly Mode[] = ['recall']

/** "3 / 12": the turn on screen among all turns (re-queued ones included, so the total can grow). */
export function sessionProgress(s: SessionState): { position: number; total: number } {
  const done = s.results.length
  return { position: done + (s.current ? 1 : 0), total: done + (s.current ? 1 : 0) + s.upcoming.length }
}

export interface SessionSummary {
  /** Distinct characters rated. */
  chars: number
  correct: number
  close: number
  wrong: number
  /** Every rating (a re-queued card counts each time). */
  ratings: number
}

export function summarize(s: SessionState): SessionSummary {
  const count = (r: SelfRating) => s.results.filter((x) => x.rating === r).length
  return {
    chars: new Set(s.results.map((r) => r.cardId)).size,
    correct: count('correct'),
    close: count('close'),
    wrong: count('wrong'),
    ratings: s.results.length,
  }
}
