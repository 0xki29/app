import { describe, expect, it } from 'vitest'
import { MAX_REQUEUES, modesFor, REQUEUE_GAP, sessionProgress, sessionReducer, startSession, summarize, type SessionAction, type SessionCard, type SessionState } from './session'

const card = (char: string, flow: SessionCard['flow'] = 'review'): SessionCard => ({ cardId: `c:${char}`, char, context: null, flow })

function run(state: SessionState, ...actions: SessionAction[]): SessionState {
  return actions.reduce(sessionReducer, state)
}

/** Rates whatever is on screen. */
const rate = (s: SessionState, rating: 'wrong' | 'close' | 'correct') => sessionReducer(s, { type: 'rated', turn: s.current!.turn, rating })

const chars = (s: SessionState) => [s.current, ...s.upcoming].filter(Boolean).map((t) => t!.char).join('')

describe('startSession', () => {
  it('keeps the queue’s order: the first card is on screen', () => {
    const s = startSession([card('一'), card('二'), card('三', 'new')])
    expect(s.current).toMatchObject({ turn: 1, char: '一', mode: 'review' })
    expect(s.upcoming.map((t) => [t.turn, t.char, t.mode])).toEqual([
      [2, '二', 'review'],
      [3, '三', 'new'],
    ])
    expect(s.ended).toBeNull()
  })

  it('an empty queue is a session already done', () => {
    expect(startSession([])).toMatchObject({ current: null, ended: 'done' })
  })
})

describe('sessionReducer', () => {
  it('moves on after each rating and ends after the last', () => {
    let s = startSession([card('一'), card('二')])
    s = rate(s, 'correct')
    expect(s.current?.char).toBe('二')
    s = rate(s, 'close')
    expect(s).toMatchObject({ current: null, ended: 'done' })
    expect(s.results.map((r) => [r.char, r.rating])).toEqual([
      ['一', 'correct'],
      ['二', 'close'],
    ])
  })

  it(`brings a "Sai" back after ${REQUEUE_GAP} other cards, as a recall`, () => {
    let s = startSession(['一', '二', '三', '四', '五', '六'].map((c) => card(c, 'new')))
    s = rate(s, 'wrong')
    expect(chars(s)).toBe('二三四一五六')
    const again = s.upcoming[2]
    expect(again).toMatchObject({ char: '一', mode: 'again', turn: 7 })
    expect(again.peeked).toBeUndefined()
    expect(modesFor(again.mode)).toEqual(['recall'])
  })

  it('brings it back last when fewer cards are left, and at once when it was the last', () => {
    let s = startSession([card('一'), card('二')])
    s = rate(s, 'wrong')
    expect(chars(s)).toBe('二一')
    expect(s.upcoming[0].peeked).toBeUndefined()
    s = rate(s, 'correct')
    expect(s.current?.char).toBe('一')
    s = rate(s, 'wrong')
    // Straight back, with its answer just shown: it starts peeked (the prompt and the log say so).
    expect(s.current).toMatchObject({ char: '一', mode: 'again', peeked: true })
  })

  it(`re-queues a card at most ${MAX_REQUEUES} times`, () => {
    let s = startSession([card('一')])
    for (let i = 0; i < MAX_REQUEUES; i++) {
      s = rate(s, 'wrong')
      expect(s.current?.char).toBe('一')
    }
    s = rate(s, 'wrong')
    expect(s).toMatchObject({ current: null, ended: 'done' })
    expect(s.results).toHaveLength(MAX_REQUEUES + 1)
  })

  it('only "Sai" re-queues', () => {
    const s = run(startSession([card('一'), card('二')]), { type: 'rated', turn: 1, rating: 'close' })
    expect(chars(s)).toBe('二')
  })

  it('ignores a rating for a turn that is not on screen (a late or repeated tap)', () => {
    const s = rate(startSession([card('一'), card('二')]), 'correct')
    expect(sessionReducer(s, { type: 'rated', turn: 1, rating: 'wrong' })).toBe(s)
    const done = rate(s, 'correct')
    expect(sessionReducer(done, { type: 'rated', turn: 2, rating: 'wrong' })).toBe(done)
  })

  it('quits early, keeping what was rated', () => {
    const s = run(rate(startSession([card('一'), card('二'), card('三')]), 'correct'), { type: 'quit' })
    expect(s).toMatchObject({ current: null, upcoming: [], ended: 'quit' })
    expect(s.results).toHaveLength(1)
    expect(sessionReducer(s, { type: 'quit' })).toBe(s)
  })
})

describe('modesFor', () => {
  it('studies a new card Xem → Tô theo → Nhớ lại, a review only Nhớ lại', () => {
    expect(modesFor('new')).toEqual(['observe', 'trace', 'recall'])
    expect(modesFor('review')).toEqual(['recall'])
    expect(modesFor('again')).toEqual(['recall'])
  })
})

describe('progress and summary', () => {
  it('counts turns, re-queued ones included', () => {
    let s = startSession([card('一'), card('二'), card('三')])
    expect(sessionProgress(s)).toEqual({ position: 1, total: 3 })
    s = rate(s, 'wrong')
    expect(sessionProgress(s)).toEqual({ position: 2, total: 4 })
  })

  it('sums up characters and ratings', () => {
    let s = startSession([card('一'), card('二'), card('三')])
    for (const r of ['wrong', 'correct', 'close', 'correct'] as const) s = rate(s, r)
    expect(summarize(s)).toEqual({ chars: 3, correct: 2, close: 1, wrong: 1, ratings: 4 })
  })
})
