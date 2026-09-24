import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { createDeck, DeckImportError, DeckOutdatedError, DeckStorageError, EXPORT_FORMAT, mergePlan, parseExport, type DeckEnv, type ReviewDetails } from './deck'
import { newCardState, replay } from './scheduler'
import { openProgressStore, type ProgressStore } from './store'
import { cardId, type CardRecord, type ReviewRecord } from './types'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const T0 = new Date(2026, 8, 24, 9, 0).getTime()

let dbCount = 0
/** A fresh database per test (fake-indexeddb keeps them for the whole file). */
const dbName = () => `test-deck-${++dbCount}`

const HSK1 = ['爱', '八', '爸', '吧', '白', '百', '半', '帮', '包', '北', '备', '本']
const WITH_STROKES = new Set([...HSK1, '学', '生', '永', '你', '國'].filter((c) => c !== '吧'))

function setup(overrides: Partial<DeckEnv> = {}) {
  let now = T0
  const name = dbName()
  const persist = vi.fn(async () => true)
  const env: DeckEnv = {
    open: (onClose) => openProgressStore(name, onClose),
    now: () => now,
    strokes: {
      has: async (c) => WITH_STROKES.has(c),
      siteData: async () => ({ dataVersion: 'test-1', hskWriting: { '1': HSK1 } }),
    },
    persist,
    ...overrides,
  }
  const deck = createDeck(env)
  return {
    deck,
    persist,
    name,
    tick: (ms: number) => (now += ms),
    setNow: (t: number) => (now = t),
    store: () => openProgressStore(name),
  }
}

const details = (over: Partial<ReviewDetails> = {}): ReviewDetails => ({
  mode: 'review',
  peeked: false,
  score: 88,
  strokeSummary: { total: 8, good: 7, off: 1, wrong: 0, missing: 0, extra: 0 },
  durationMs: 12_345,
  ...over,
})

const XUESHENG = { key: '學生|学生[xue2 sheng5]', simp: '学生', pinyin: 'xue2 sheng5', vi: 'học sinh' }

describe('ProgressStore (IndexedDB)', () => {
  it('creates the three stores, adds cards once, and logs reviews with the card’s new state together', async () => {
    const s: ProgressStore = await openProgressStore(dbName())
    const card: CardRecord = { id: cardId('学'), char: '学', hex: '5b66', addedAt: T0, context: null, fsrs: newCardState(T0), dataVersion: null }
    expect(await s.addCards([card])).toEqual({ added: [card], existing: [] })
    expect(await s.addCards([card])).toEqual({ added: [], existing: [card.id] })
    const review: ReviewRecord = { cardId: card.id, at: T0 + MIN, rating: 'correct', mode: 'new', prevState: 'new', durationMs: 5 }
    const next = { ...card, fsrs: { ...card.fsrs, reps: 1 } }
    await s.recordReview(next, { ...review, id: 999 })
    expect((await s.getCard(card.id))?.fsrs.reps).toBe(1)
    const log = await s.allReviews()
    expect(log).toHaveLength(1)
    expect(log[0].id).not.toBe(999)
    expect(await s.reviewsSince(T0 + 2 * MIN)).toEqual([])
    expect(await s.reviewsSince(T0)).toHaveLength(1)
    await s.setMeta('x', { a: 1 })
    expect(await s.getMeta('x')).toEqual({ a: 1 })
    await s.deleteCard(card.id)
    expect(await s.getCard(card.id)).toBeUndefined()
    expect(await s.allReviews()).toHaveLength(1)
    s.close()
  })
})

describe('deck.add', () => {
  it('adds one writing card per character with stroke data, keeping the word as context', async () => {
    const { deck, persist } = setup()
    const r = await deck.add([
      { char: '学', context: XUESHENG },
      { char: '生', context: XUESHENG },
    ])
    expect(r).toEqual({ added: 2, existing: 0, skipped: [] })
    const card = await deck.get('学')
    expect(card).toMatchObject({ id: 'c:5b66#write', char: '学', hex: '5b66', addedAt: T0, context: XUESHENG, dataVersion: 'test-1' })
    expect(card?.fsrs.state).toBe('new')
    expect(await deck.has('生')).toBe(true)
    expect(await deck.has('永')).toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('reports characters already in the deck and characters without stroke data', async () => {
    const { deck, persist } = setup()
    await deck.add([{ char: '学' }])
    const r = await deck.add([{ char: '学' }, { char: '吧' }, { char: 'A' }, { char: '永' }, { char: '永' }])
    expect(r).toEqual({ added: 1, existing: 1, skipped: ['A', '吧'] })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('announces changes to subscribers', async () => {
    const { deck } = setup()
    const seen = vi.fn()
    const off = deck.subscribe(seen)
    const v = deck.version()
    await deck.add([{ char: '学' }])
    expect(seen).toHaveBeenCalledTimes(1)
    expect(deck.version()).toBe(v + 1)
    await deck.remove('学')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(await deck.has('学')).toBe(false)
    off()
  })

  it('fails with a storage error the learner can read when IndexedDB is not there', async () => {
    const { deck } = setup({ open: () => Promise.reject(new Error('blocked')) })
    await expect(deck.add([{ char: '学' }])).rejects.toBeInstanceOf(DeckStorageError)
    await expect(deck.today()).rejects.toThrow(/Trình duyệt không cho lưu/)
  })

  it('says "reload the page", not "private mode", once another tab upgraded the database (DECK-10)', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    // A newer app in another tab opens version 2: this tab's connection is closed for it…
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(t.name, 2)
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    // …and its next request fails: the database is newer than this page's code.
    const err = await t.deck.today().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeckOutdatedError)
    expect((err as Error).message).toMatch(/tải lại trang/)
  })
})

describe('deck.today and deck.review', () => {
  it('queues due reviews first, then the day’s new cards in the order they were added', async () => {
    const t = setup()
    await t.deck.add(['永', '你', '学'].map((char) => ({ char })))
    const plan = await t.deck.today()
    expect(plan).toMatchObject({ total: 3, due: 0, fresh: 3 })
    expect(plan.queue.map((q) => [q.char, q.flow])).toEqual([
      ['永', 'new'],
      ['你', 'new'],
      ['学', 'new'],
    ])
  })

  it('records the self-rating as the grade, and logs the rest next to it', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    t.tick(MIN)
    const after = await t.deck.review(cardId('学'), 'correct', details({ mode: 'new', score: 12 }))
    expect(after?.fsrs).toMatchObject({ state: 'learning', due: T0 + 11 * MIN })
    const s = await t.store()
    const [log] = await s.allReviews()
    expect(log).toMatchObject({ cardId: 'c:5b66#write', at: T0 + MIN, rating: 'correct', mode: 'new', prevState: 'new', score: 12, durationMs: 12_345 })
    expect(log.strokeSummary).toEqual(details().strokeSummary)
    s.close()
  })

  it('a low score never lowers the grade: "Đúng" with score 5 schedules like "Đúng" with 95', async () => {
    const a = setup()
    const b = setup()
    for (const t of [a, b]) await t.deck.add([{ char: '学' }])
    const low = await a.deck.review(cardId('学'), 'correct', details({ score: 5 }))
    const high = await b.deck.review(cardId('学'), 'correct', details({ score: 95 }))
    expect(low?.fsrs).toEqual(high?.fsrs)
  })

  it('stores the same state a replay of the log gives', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    const ratings = ['wrong', 'correct', 'correct', 'close', 'correct'] as const
    const gaps = [MIN, 2 * MIN, 10 * MIN, 2 * DAY, 5 * DAY]
    for (let i = 0; i < ratings.length; i++) {
      t.tick(gaps[i])
      await t.deck.review(cardId('学'), ratings[i], details())
    }
    const s = await t.store()
    const card = (await s.getCard(cardId('学')))!
    expect(card.fsrs).toEqual(replay(card.addedAt, await s.allReviews()))
    s.close()
  })

  it('introduces at most newPerDay cards per learning day, counting from 04:00', async () => {
    const t = setup()
    await t.deck.setSettings({ newPerDay: 2 })
    await t.deck.add(['永', '你', '学', '國'].map((char) => ({ char })))
    for (const c of ['永', '你']) await t.deck.review(cardId(c), 'correct', details({ mode: 'new' }))
    t.tick(30 * MIN)
    let plan = await t.deck.today()
    expect(plan).toMatchObject({ fresh: 0, introduced: 2, newWaiting: 2 })
    // Both learning cards (10-minute step) are due again by now.
    expect(plan.queue.map((q) => q.char).sort()).toEqual(['你', '永'])
    t.setNow(new Date(2026, 8, 25, 3, 59).getTime())
    expect((await t.deck.today()).fresh).toBe(0)
    t.setNow(new Date(2026, 8, 25, 4, 0).getTime())
    plan = await t.deck.today()
    expect(plan.fresh).toBe(2)
    expect(plan.queue.slice(-2).map((q) => q.char)).toEqual(['学', '國'])
  })

  it('a card removed during a session is not rated (null), and nothing is logged', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    await t.deck.remove('学')
    expect(await t.deck.review(cardId('学'), 'correct', details())).toBeNull()
    const s = await t.store()
    expect(await s.allReviews()).toEqual([])
    s.close()
  })

  it('logs the time the schedule used: a clock set back never makes the log disagree with the card (DECK-2)', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    t.tick(-60 * MIN) // the clock goes back an hour
    await t.deck.review(cardId('学'), 'correct', details({ mode: 'new' }))
    t.tick(5 * MIN)
    await t.deck.review(cardId('学'), 'wrong', details())
    t.tick(-3 * MIN) // and back a little again
    await t.deck.review(cardId('学'), 'correct', details())
    const s = await t.store()
    const card = (await s.getCard(cardId('学')))!
    const log = await s.allReviews()
    expect(log.map((r) => r.at)).toEqual([T0, T0 + 1, T0 + 2])
    expect(card.fsrs).toEqual(replay(card.addedAt, log))
    expect(card.fsrs.reps).toBe(3)
    s.close()
  })

  it('keeps a rating made after importing a card from a device whose clock ran ahead (DECK-2)', async () => {
    const b = setup()
    b.setNow(T0 + 60 * MIN) // B's clock is an hour ahead
    await b.deck.add([{ char: '学' }])
    b.tick(MIN)
    await b.deck.review(cardId('学'), 'correct', details({ mode: 'new' }))
    const a = setup()
    await a.deck.importData(await b.deck.exportData())
    a.tick(10 * MIN)
    await a.deck.review(cardId('学'), 'wrong', details())
    b.tick(20 * MIN)
    await b.deck.review(cardId('学'), 'correct', details())
    await a.deck.importData(await b.deck.exportData())
    const s = await a.store()
    const card = (await s.getCard(cardId('学')))!
    const log = await s.allReviews()
    expect(log.map((r) => r.rating)).toEqual(['correct', 'wrong', 'correct'])
    // A's "Sai" is in the replayed schedule: three reviews, the lapse included.
    expect(card.fsrs.reps).toBe(3)
    expect(card.fsrs).toEqual(replay(card.addedAt, log))
    s.close()
  })

  it('applies two quick ratings of the same card in order', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    const [first, second] = await Promise.all([
      t.deck.review(cardId('学'), 'wrong', details()),
      t.deck.review(cardId('学'), 'correct', details()),
    ])
    expect(first?.fsrs.reps).toBe(1)
    expect(second?.fsrs.reps).toBe(2)
  })
})

describe('deck.addNextHsk', () => {
  it('adds the next characters of the list in order, skipping those in the deck or without stroke data', async () => {
    const t = setup()
    await t.deck.add([{ char: '八' }])
    t.tick(MIN)
    const r = await t.deck.addNextHsk(1, 5)
    expect(r.chars).toEqual(['爱', '爸', '白', '百', '半'])
    expect(r.added).toBe(5)
    expect(await t.deck.hskProgress(1)).toEqual({ level: 1, cursor: 7, total: HSK1.length })
    const plan = await t.deck.today()
    expect(plan.queue.map((q) => q.char)).toEqual(['八', '爱', '爸', '白', '百', '半'])
  })

  it('goes on from where it stopped, even after a card was removed, until the list ends', async () => {
    const t = setup()
    await t.deck.addNextHsk(1, 10)
    await t.deck.remove('爱')
    const r = await t.deck.addNextHsk(1, 10)
    expect(r.chars).toEqual(['本'])
    expect(await t.deck.hskProgress(1)).toMatchObject({ cursor: HSK1.length })
    expect((await t.deck.addNextHsk(1, 10)).added).toBe(0)
  })

  it('has no progress without the data (no manifest)', async () => {
    const t = setup({ strokes: { has: async () => false, siteData: async () => null } })
    expect(await t.deck.hskProgress(1)).toBeNull()
    expect((await t.deck.addNextHsk(1, 10)).added).toBe(0)
  })

  it('moves the cursor only once the cards are in: a failed add offers the same characters again (DECK-3)', async () => {
    let fail = true
    const name = dbName()
    const t = setup({
      open: async (onClose) => {
        const s = await openProgressStore(name, onClose)
        return {
          ...s,
          addCards: async (cards) => {
            if (fail) {
              fail = false
              throw new DOMException('quota', 'QuotaExceededError')
            }
            return s.addCards(cards)
          },
        }
      },
    })
    await expect(t.deck.addNextHsk(1, 10)).rejects.toThrow()
    expect(await t.deck.hskProgress(1)).toMatchObject({ cursor: 0 })
    const r = await t.deck.addNextHsk(1, 10)
    expect(r.chars).toEqual(['爱', '八', '爸', '白', '百', '半', '帮', '包', '北', '备'])
  })

  it('offers nothing and keeps the cursor when the stroke list cannot be loaded (a missing list is no "no strokes")', async () => {
    const t = setup({
      strokes: {
        has: () => Promise.reject(new Error('list missing')),
        siteData: async () => ({ dataVersion: 'test-1', hskWriting: { '1': HSK1 } }),
      },
    })
    await expect(t.deck.addNextHsk(1, 10)).rejects.toThrow('list missing')
    expect(await t.deck.hskProgress(1)).toMatchObject({ cursor: 0, total: HSK1.length })
  })

  it('tells a network failure (rejects) from data without the list (null) (PERF-2)', async () => {
    const t = setup({ strokes: { has: async () => true, siteData: () => Promise.reject(new TypeError('Failed to fetch')) } })
    await expect(t.deck.hskProgress(1)).rejects.toThrow('Failed to fetch')
  })

  it('gives each quick-added character the word it is learned in (the manifest’s hskContext)', async () => {
    const t = setup({
      strokes: {
        has: async (c) => WITH_STROKES.has(c),
        siteData: async () => ({
          dataVersion: 'test-1',
          hskWriting: { '1': HSK1 },
          hskContext: { 爱: ['愛好|爱好[ai4 hao4]', 'sở thích'], 北: ['北京|北京[Bei3 jing1]', 'Bắc Kinh', true], 八: ['bad key', 'x'] },
        }),
      },
    })
    await t.deck.addNextHsk(1, 10)
    expect((await t.deck.get('爱'))?.context).toEqual({ key: '愛好|爱好[ai4 hao4]', simp: '爱好', pinyin: 'ai4 hao4', vi: 'sở thích' })
    expect((await t.deck.get('北'))?.context).toMatchObject({ simp: '北京', pn: true })
    expect((await t.deck.get('八'))?.context).toBeNull()
  })
})

describe('export and import', () => {
  it('round-trips a deck into an empty one, with the same schedule', async () => {
    const a = setup()
    await a.deck.add([{ char: '学', context: XUESHENG }, { char: '永' }])
    a.tick(MIN)
    await a.deck.review(cardId('学'), 'correct', details({ mode: 'new' }))
    a.tick(20 * MIN)
    await a.deck.review(cardId('学'), 'correct', details())
    await a.deck.addNextHsk(1, 2)
    const data = await a.deck.exportData()
    expect(data).toMatchObject({ format: EXPORT_FORMAT, version: 1 })
    expect(data.reviews.every((r) => r.id === undefined)).toBe(true)

    const b = setup()
    const result = await b.deck.importData(JSON.parse(JSON.stringify(data)))
    expect(result).toEqual({ cardsAdded: 4, cardsUpdated: 0, cardsRemoved: 0, reviewsAdded: 2, skipped: 0 })
    expect((await b.deck.get('学'))?.fsrs).toEqual((await a.deck.get('学'))?.fsrs)
    expect((await b.deck.get('学'))?.context).toEqual(XUESHENG)
    expect(await b.deck.hskProgress(1)).toMatchObject({ cursor: 2 })
  })

  it('merges: an import twice adds nothing, and reviews from another device reschedule the card', async () => {
    const a = setup()
    await a.deck.add([{ char: '学' }])
    const b = setup()
    await b.deck.importData(await a.deck.exportData())
    a.tick(MIN)
    await a.deck.review(cardId('学'), 'correct', details())
    b.tick(3 * MIN)
    await b.deck.review(cardId('学'), 'correct', details())
    const fromA = await a.deck.exportData()
    expect(await b.deck.importData(fromA)).toMatchObject({ cardsAdded: 0, reviewsAdded: 1 })
    expect(await b.deck.importData(fromA)).toMatchObject({ cardsAdded: 0, reviewsAdded: 0 })
    const s = await b.store()
    const card = (await s.getCard(cardId('学')))!
    expect(card.fsrs.reps).toBe(2)
    expect(card.fsrs).toEqual(replay(card.addedAt, await s.allReviews()))
    s.close()
  })

  it('refuses a file that is not a deck export, and skips invalid records', () => {
    expect(() => parseExport(null)).toThrow(DeckImportError)
    expect(() => parseExport({ format: 'other' })).toThrow(DeckImportError)
    expect(() => parseExport({ format: EXPORT_FORMAT, version: 2 })).toThrow(/phiên bản/)
    const parsed = parseExport({
      format: EXPORT_FORMAT,
      version: 1,
      cards: [
        { id: 'c:5b66#write', char: '学', addedAt: T0, context: null },
        { id: 'c:41#write', char: 'A', addedAt: T0 },
        { id: 'c:6c38#write', char: '学', addedAt: T0 },
        { id: 'c:6c38#write', char: '永', addedAt: 'yesterday' },
      ],
      reviews: [
        { cardId: 'c:5b66#write', at: T0 + MIN, rating: 'correct', mode: 'new', prevState: 'new', durationMs: 3 },
        { cardId: 'c:5b66#write', at: T0 + MIN, rating: 'maybe' },
        { cardId: 'nope', at: T0, rating: 'wrong' },
      ],
    })
    expect(parsed.cards.map((c) => c.char)).toEqual(['学'])
    expect(parsed.reviews).toHaveLength(1)
    expect(parsed.skipped).toBe(5)
  })

  it('rejects times that are no real date for a deck: before 2020, or more than a day after the export (DECK-6)', () => {
    const exportedAt = new Date(T0).toISOString()
    const parsed = parseExport(
      {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt,
        cards: [
          { id: 'c:5b66#write', char: '学', addedAt: T0 - DAY },
          { id: 'c:6c38#write', char: '永', addedAt: 1e300 },
          { id: 'c:4f60#write', char: '你', addedAt: Date.UTC(2019, 0, 1) },
        ],
        reviews: [
          { cardId: 'c:5b66#write', at: T0 - DAY + MIN, rating: 'correct', score: 1e308, strokeSummary: { total: 1, good: 1, junk: { a: 1 } }, durationMs: -5 },
          { cardId: 'c:5b66#write', at: Date.UTC(3000, 0, 1), rating: 'correct' },
          { cardId: 'c:5b66#write', at: T0 + 2 * DAY, rating: 'wrong' },
        ],
        meta: { removed: { 'c:6c38#write': T0, 'c:4f60#write': Date.UTC(3000, 0, 1), nope: T0 } },
      },
      T0,
    )
    expect(parsed.cards.map((c) => c.char)).toEqual(['学'])
    expect(parsed.reviews).toHaveLength(1)
    expect(parsed.skipped).toBe(4)
    expect(parsed.reviews[0]).toMatchObject({ score: 100, durationMs: 0, strokeSummary: { total: 1, good: 1, off: 0, wrong: 0, missing: 0, extra: 0 } })
    expect(Object.keys(parsed.reviews[0].strokeSummary!)).not.toContain('junk')
    expect(parsed.removed).toEqual({ 'c:6c38#write': T0 })
  })

  it('an import does not bring back a card removed after the backup was made (#44)', async () => {
    const t = setup()
    await t.deck.add([{ char: '学' }])
    t.tick(MIN)
    await t.deck.review(cardId('学'), 'correct', details({ mode: 'new' }))
    const backup = await t.deck.exportData()
    t.tick(MIN)
    await t.deck.remove('学')
    expect(await t.deck.importData(backup)).toMatchObject({ cardsAdded: 0, reviewsAdded: 0 })
    expect(await t.deck.has('学')).toBe(false)
    // Added again, it starts afresh, and the old backup neither replaces it nor its "added" time.
    t.tick(MIN)
    await t.deck.add([{ char: '学' }])
    expect(await t.deck.importData(backup)).toMatchObject({ cardsAdded: 0, cardsUpdated: 0 })
    const card = (await t.deck.get('学'))!
    expect(card.addedAt).toBe(T0 + 3 * MIN)
    expect(card.fsrs.state).toBe('new')
  })

  it('a removal on the other device carries over, unless the card was added again after it (#44)', async () => {
    const a = setup()
    await a.deck.add([{ char: '学' }, { char: '永' }])
    const b = setup()
    await b.deck.importData(await a.deck.exportData())
    b.tick(MIN)
    await b.deck.remove('学')
    await b.deck.remove('永')
    b.tick(MIN)
    await b.deck.add([{ char: '永' }])
    const fromB = await b.deck.exportData()
    expect(Object.keys(fromB.meta.removed).sort()).toEqual([cardId('学'), cardId('永')].sort())
    a.tick(5 * MIN)
    // 学 is gone; A's 永 gives way to B's, added again after the removal (it starts afresh).
    expect(await a.deck.importData(fromB)).toMatchObject({ cardsRemoved: 1, cardsAdded: 1 })
    expect(await a.deck.has('学')).toBe(false)
    expect((await a.deck.get('永'))?.addedAt).toBe(T0 + 2 * MIN)
    // And A's own export now carries the removals on.
    expect((await a.deck.exportData()).meta.removed[cardId('学')]).toBe(T0 + MIN)
  })

  it('does not trust the FSRS state in a file: it is recomputed from the reviews', () => {
    const forged = { ...newCardState(T0), state: 'review' as const, due: T0 + 999 * DAY, stability: 999 }
    const incoming = parseExport({
      format: EXPORT_FORMAT,
      version: 1,
      cards: [{ id: 'c:5b66#write', char: '学', addedAt: T0, fsrs: forged }],
      reviews: [],
    })
    const plan = mergePlan([], [], incoming)
    expect(plan.cards[0].fsrs).toEqual(newCardState(T0))
  })
})
