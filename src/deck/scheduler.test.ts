import { describe, expect, it } from 'vitest'
import { applyRating, countIntroduced, dayStart, isDue, newCardState, nextDayStart, planToday, replay } from './scheduler'
import { DEFAULT_SETTINGS, type FsrsCardState, type SelfRating } from './types'

// Local times (the learning day is local): these tests hold in any time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN
const HOUR = 4

function rate(state: FsrsCardState, ...steps: [SelfRating, number][]): FsrsCardState {
  return steps.reduce((s, [r, t]) => applyRating(s, r, t), state)
}

describe('FSRS grades from the self-rating', () => {
  const t0 = at(24, 9)
  const fresh = newCardState(t0)

  it('starts a card new and due at once', () => {
    expect(fresh).toMatchObject({ state: 'new', due: t0, reps: 0, lapses: 0, lastReview: null })
  })

  it('Sai → Again, Gần đúng → Hard, Đúng → Good: the learning steps (1 min, 6 min, 10 min)', () => {
    expect(applyRating(fresh, 'wrong', t0)).toMatchObject({ state: 'learning', due: t0 + MIN })
    expect(applyRating(fresh, 'close', t0)).toMatchObject({ state: 'learning', due: t0 + 6 * MIN })
    expect(applyRating(fresh, 'correct', t0)).toMatchObject({ state: 'learning', due: t0 + 10 * MIN, lastReview: t0 })
  })

  it('graduates after the learning steps, then spaces reviews out', () => {
    const learnt = rate(fresh, ['correct', t0], ['correct', t0 + 10 * MIN])
    expect(learnt.state).toBe('review')
    expect(learnt.scheduledDays).toBe(2)
    const next = applyRating(learnt, 'correct', learnt.due)
    expect(next.scheduledDays).toBeGreaterThan(learnt.scheduledDays * 3)
  })

  it('a lapse ("Sai" on a review) goes back to relearning, 10 minutes later', () => {
    const learnt = rate(fresh, ['correct', t0], ['correct', t0 + 10 * MIN])
    const lapsed = applyRating(learnt, 'wrong', learnt.due)
    expect(lapsed).toMatchObject({ state: 'relearning', due: learnt.due + 10 * MIN, lapses: 1 })
  })

  it('"Gần đúng" schedules sooner than "Đúng"', () => {
    const learnt = rate(fresh, ['correct', t0], ['correct', t0 + 10 * MIN])
    expect(applyRating(learnt, 'close', learnt.due).due).toBeLessThan(applyRating(learnt, 'correct', learnt.due).due)
  })

  it('treats a rating before the last one (a clock set back) as made at the last one', () => {
    const once = applyRating(fresh, 'correct', t0)
    const back = applyRating(once, 'correct', t0 - 5 * DAY)
    expect(back).toEqual(applyRating(once, 'correct', t0))
    expect(Number.isFinite(back.stability)).toBe(true)
  })
})

describe('replay', () => {
  const t0 = at(24, 9)
  const log: { at: number; rating: SelfRating }[] = [
    { at: t0 + MIN, rating: 'wrong' },
    { at: t0 + 5 * MIN, rating: 'correct' },
    { at: t0 + 20 * MIN, rating: 'correct' },
    { at: t0 + 3 * DAY, rating: 'close' },
    { at: t0 + 9 * DAY, rating: 'correct' },
  ]

  it('recomputes exactly the state the ratings produced one by one', () => {
    const stepwise = log.reduce((s, r) => applyRating(s, r.rating, r.at), newCardState(t0))
    expect(replay(t0, log)).toEqual(stepwise)
  })

  it('orders the log by time, and ignores reviews from before the card was (re-)added', () => {
    const shuffled = [log[3], log[0], log[4], log[2], log[1]]
    expect(replay(t0, shuffled)).toEqual(replay(t0, log))
    expect(replay(t0, [{ at: t0 - DAY, rating: 'wrong' }, ...log])).toEqual(replay(t0, log))
  })

  it('with no reviews is a new card', () => {
    expect(replay(t0, [])).toEqual(newCardState(t0))
  })
})

describe('learning days (start at 04:00 local)', () => {
  it('a review at 1 a.m. belongs to the day before', () => {
    expect(dayStart(at(25, 1), HOUR)).toBe(at(24, 4))
    expect(dayStart(at(25, 3, 59), HOUR)).toBe(at(24, 4))
    expect(dayStart(at(25, 4), HOUR)).toBe(at(25, 4))
    expect(dayStart(at(25, 23), HOUR)).toBe(at(25, 4))
    expect(nextDayStart(at(25, 1), HOUR)).toBe(at(25, 4))
    expect(nextDayStart(at(25, 12), HOUR)).toBe(at(26, 4))
  })

  it('a review card is due for its whole learning day; a learning step at its minute; a new card never', () => {
    const now = at(24, 12)
    const review = (due: number): FsrsCardState => ({ ...newCardState(0), state: 'review', due })
    expect(isDue(review(at(24, 22)), now, HOUR)).toBe(true)
    expect(isDue(review(at(25, 3)), now, HOUR)).toBe(true)
    expect(isDue(review(at(25, 4)), now, HOUR)).toBe(false)
    const step = (due: number): FsrsCardState => ({ ...newCardState(0), state: 'learning', due })
    expect(isDue(step(now - MIN), now, HOUR)).toBe(true)
    expect(isDue(step(now + 5 * MIN), now, HOUR)).toBe(false)
    expect(isDue(newCardState(now - DAY), now, HOUR)).toBe(false)
  })
})

describe('planToday', () => {
  const now = at(24, 12)
  const card = (id: string, addedAt: number, fsrs: Partial<FsrsCardState>) => ({ id, addedAt, fsrs: { ...newCardState(addedAt), ...fsrs } })

  it('puts the due reviews first, oldest due first, then new cards up to the allowance left', () => {
    const cards = [
      card('n2', 5, {}),
      card('r-late', 1, { state: 'review', due: at(24, 11) }),
      card('n1', 4, {}),
      card('r-early', 2, { state: 'review', due: at(20, 9) }),
      card('r-tomorrow', 3, { state: 'review', due: at(25, 9) }),
      card('l-soon', 6, { state: 'learning', due: now + 5 * MIN }),
      card('n3', 7, {}),
    ]
    const plan = planToday(cards, 1, now, { ...DEFAULT_SETTINGS, newPerDay: 3 })
    expect(plan.due.map((c) => c.id)).toEqual(['r-early', 'r-late'])
    expect(plan.fresh.map((c) => c.id)).toEqual(['n1', 'n2'])
    expect(plan).toMatchObject({ introduced: 1, newWaiting: 1, laterToday: 1, nextDue: now + 5 * MIN })
  })

  it('offers no new card once the day’s allowance is used', () => {
    const plan = planToday([card('n', 1, {})], 10, now, DEFAULT_SETTINGS)
    expect(plan.fresh).toEqual([])
    expect(plan.newWaiting).toBe(1)
  })

  it('counts a card introduced by its first review since the day started', () => {
    const reviews = [
      { cardId: 'a', at: at(24, 5), prevState: 'new' as const },
      { cardId: 'a', at: at(24, 5, 10), prevState: 'learning' as const },
      { cardId: 'b', at: at(24, 3), prevState: 'new' as const },
      { cardId: 'c', at: at(24, 11), prevState: 'review' as const },
    ]
    expect(countIntroduced(reviews, now, HOUR)).toBe(1)
  })
})
