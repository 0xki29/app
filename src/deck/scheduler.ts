import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs'
import type { CardState, DeckSettings, FsrsCardState, SelfRating } from './types'

/**
 * Scheduling with FSRS (ts-fsrs, default parameters): the learner's self-rating is the grade —
 * Sai → Again, Gần đúng → Hard, Đúng → Good; there is no Easy, and the automatic score never
 * grades. Fuzz is off (ts-fsrs's default), so the schedule is a pure function of the review log:
 * replay() recomputes any card's state from its log and gets the state stored.
 *
 * A learning day starts at `dayStartHour` (04:00) local time: a card due any time before the next
 * day start is due "today". Cards in (re)learning steps (minutes apart) are due at their minute.
 */

const scheduler = fsrs({ enable_fuzz: false })

export const GRADE: Record<SelfRating, Grade> = { wrong: Rating.Again, close: Rating.Hard, correct: Rating.Good }

const STATE_NAME: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}
const STATE_OF: Record<CardState, State> = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning }

function fromCard(c: Card): FsrsCardState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_NAME[c.state],
    lastReview: c.last_review ? c.last_review.getTime() : null,
  }
}

function toCard(s: FsrsCardState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: STATE_OF[s.state],
    last_review: s.lastReview === null ? undefined : new Date(s.lastReview),
  }
}

/** A card never reviewed, due at once. */
export function newCardState(now: number): FsrsCardState {
  return fromCard(createEmptyCard(new Date(now)))
}

/** The state after a self-rating at `at`. A time before the last review (a clock set back) counts as that time. */
export function applyRating(state: FsrsCardState, rating: SelfRating, at: number): FsrsCardState {
  const when = Math.max(at, state.lastReview ?? at)
  return fromCard(scheduler.next(toCard(state), new Date(when), GRADE[rating]).card)
}

/** A card's state recomputed from its reviews (those from `addedAt` on, in time order). */
export function replay(addedAt: number, reviews: readonly { at: number; rating: SelfRating }[]): FsrsCardState {
  const ordered = reviews.filter((r) => r.at >= addedAt).sort((a, b) => a.at - b.at)
  let state = newCardState(addedAt)
  for (const r of ordered) state = applyRating(state, r.rating, r.at)
  return state
}

// ── Learning days ──────────────────────────────────────────────────────────

/** When the learning day that contains `now` started (local time, at `hour`). */
export function dayStart(now: number, hour: number): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() > now) {
    d.setDate(d.getDate() - 1)
    d.setHours(hour, 0, 0, 0)
  }
  return d.getTime()
}

/** When the next learning day starts. */
export function nextDayStart(now: number, hour: number): number {
  const d = new Date(dayStart(now, hour))
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

/** A review card is due for the whole learning day it falls in; a (re)learning step at its minute. New cards are never "due". */
export function isDue(s: Pick<FsrsCardState, 'state' | 'due'>, now: number, hour: number): boolean {
  if (s.state === 'new') return false
  if (s.state === 'review') return s.due < nextDayStart(now, hour)
  return s.due <= now
}

// ── Today's plan ───────────────────────────────────────────────────────────

interface Schedulable {
  id: string
  addedAt: number
  fsrs: FsrsCardState
}

export interface TodayPlan<T> {
  /** Due now, oldest due first. */
  due: T[]
  /** New cards to introduce now, oldest added first (the day's allowance left). */
  fresh: T[]
  /** New cards introduced today already. */
  introduced: number
  /** New cards waiting beyond today's allowance. */
  newWaiting: number
  /** Cards in (re)learning steps that come due later today. */
  laterToday: number
  /** The next time a card not due now comes due (null: none scheduled). */
  nextDue: number | null
}

/**
 * What to study now: the due reviews, then new cards up to the day's allowance (`newPerDay` minus
 * those introduced since the day started — a card is introduced by its first review).
 */
export function planToday<T extends Schedulable>(
  cards: readonly T[],
  introducedToday: number,
  now: number,
  settings: DeckSettings,
): TodayPlan<T> {
  const hour = settings.dayStartHour
  const due: T[] = []
  const fresh: T[] = []
  let laterToday = 0
  let nextDue: number | null = null
  const end = nextDayStart(now, hour)
  for (const c of cards) {
    if (c.fsrs.state === 'new') fresh.push(c)
    else if (isDue(c.fsrs, now, hour)) due.push(c)
    else {
      if (c.fsrs.due < end) laterToday++
      if (nextDue === null || c.fsrs.due < nextDue) nextDue = c.fsrs.due
    }
  }
  due.sort((a, b) => a.fsrs.due - b.fsrs.due || a.id.localeCompare(b.id))
  fresh.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
  const allowance = Math.max(0, settings.newPerDay - introducedToday)
  return {
    due,
    fresh: fresh.slice(0, allowance),
    introduced: introducedToday,
    newWaiting: Math.max(0, fresh.length - allowance),
    laterToday,
    nextDue,
  }
}

/** How many distinct cards had their first review since the learning day started. */
export function countIntroduced(reviews: readonly { cardId: string; at: number; prevState: CardState }[], now: number, hour: number): number {
  const from = dayStart(now, hour)
  const ids = new Set<string>()
  for (const r of reviews) if (r.prevState === 'new' && r.at >= from) ids.add(r.cardId)
  return ids.size
}
