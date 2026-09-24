import { parseKey } from '../dict/row'
import { applyRating, countIntroduced, dayStart, newCardState, planToday, replay, type TodayPlan } from './scheduler'
import { REMOVED_KEY, type ProgressStore, type Removals } from './store'
import {
  cardId,
  DEFAULT_SETTINGS,
  type CardContext,
  type CardRecord,
  type DeckSettings,
  type ReviewMode,
  type ReviewRecord,
  type SelfRating,
  type StrokeTally,
} from './types'

/**
 * The review deck ("Sổ ôn tập"): writing cards, one per character, scheduled by FSRS from the
 * learner's self-ratings. Plain TypeScript over a ProgressStore (IndexedDB in the app, fake-indexeddb
 * in the tests) with an injectable clock. Writes run one at a time, in order, so two ratings of the
 * same card (a "Sai" re-queued in a session) never race; every change is announced to subscribers
 * (and to other tabs, through `broadcast`).
 */

export interface AddCardInput {
  char: string
  context?: CardContext
}

export interface AddResult {
  added: number
  existing: number
  /** Characters left out because they have no stroke data (a writing card needs it). */
  skipped: string[]
}

/** What the rating came with, logged next to it (never the grade). */
export interface ReviewDetails {
  mode: ReviewMode
  peeked: boolean
  score: number | null
  strokeSummary: StrokeTally | null
  durationMs: number
}

/** A card to study now, in the order to study it. */
export interface StudyItem {
  cardId: string
  char: string
  context: CardContext | null
  flow: 'new' | 'review'
}

export interface Today extends Omit<TodayPlan<CardRecord>, 'due' | 'fresh'> {
  /** When this was computed (the deck's clock), and the hour learning days start: for due texts. */
  now: number
  dayStartHour: number
  total: number
  due: number
  fresh: number
  /** The study queue: due reviews, oldest due first, then the new cards. */
  queue: StudyItem[]
}

export interface HskProgress {
  level: number
  /** Position in the level's writing list up to which characters were offered. */
  cursor: number
  total: number
}

export interface ImportResult {
  cardsAdded: number
  cardsUpdated: number
  /** Cards here that the other side removed after they were added. */
  cardsRemoved: number
  reviewsAdded: number
  /** Records that were not valid and were left out. */
  skipped: number
}

export const EXPORT_FORMAT = 'chinese-notebook-deck'
export const EXPORT_VERSION = 1

export interface DeckExport {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  cards: CardRecord[]
  reviews: ReviewRecord[]
  /** `removed`: card id → when it was last removed, so a merge does not bring a removed card back. */
  meta: { settings: DeckSettings; hskCursor: Record<string, number>; removed: Removals }
}

/** The deck's data could not be read or written (no IndexedDB, storage blocked, a broken database). */
export class DeckStorageError extends Error {
  constructor(cause: unknown) {
    super('Trình duyệt không cho lưu dữ liệu nên sổ ôn tập chưa dùng được (có thể do chế độ ẩn danh hoặc bộ nhớ đầy).', { cause })
    this.name = 'DeckStorageError'
  }
}

/**
 * A newer version of the app, open in another tab, upgraded the database: this page's code is out
 * of date and cannot read or write it until it is reloaded.
 */
export class DeckOutdatedError extends Error {
  constructor(cause: unknown) {
    super('Ứng dụng vừa được cập nhật ở một thẻ khác của trình duyệt. Hãy tải lại trang để tiếp tục dùng sổ ôn tập.', { cause })
    this.name = 'DeckOutdatedError'
  }
}

/** The import file is not a deck export this app understands. */
export class DeckImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeckImportError'
  }
}

export interface DeckEnv {
  open: (onClose: () => void) => Promise<ProgressStore>
  now: () => number
  /** Stroke availability and the data manifest (strokeData.ts). Both reject on a network failure. */
  strokes: {
    has(char: string): Promise<boolean>
    siteData(): Promise<DeckSiteData | null>
  }
  /** Asks the browser to keep the data (navigator.storage.persist), once, on the first card added. */
  persist?: () => Promise<unknown>
  /** Tells other tabs about a change, and hears theirs. */
  broadcast?: { post(): void; listen(onChange: () => void): () => void }
}

/** What the deck reads from the data manifest. */
export interface DeckSiteData {
  dataVersion: string
  /** HSK 3.0 writing lists by level ('1'–'3'), in the order they are offered (most frequent first). */
  hskWriting: Readonly<Record<string, readonly string[]>>
  /** Level-1 characters → the word a quick-added card is learned in: [entry key, its first meaning, the word is a proper noun]. */
  hskContext?: Readonly<Record<string, readonly [string, string, boolean?]>>
}

export interface Deck {
  add(cards: readonly AddCardInput[]): Promise<AddResult>
  has(char: string): Promise<boolean>
  get(char: string): Promise<CardRecord | null>
  remove(char: string): Promise<void>
  list(): Promise<CardRecord[]>
  today(): Promise<Today>
  /** Records a self-rating: FSRS grade from the rating, the rest logged. Null when the card is gone (removed meanwhile). */
  review(cardId: string, rating: SelfRating, details: ReviewDetails): Promise<CardRecord | null>
  /**
   * Adds the next `count` characters of an HSK writing list not offered yet (with stroke data, not
   * in the deck), each with the word it is learned in. Rejects, offering nothing, when the manifest
   * or the stroke list cannot be loaded.
   */
  addNextHsk(level: 1 | 2 | 3, count: number): Promise<AddResult & { chars: string[] }>
  /** Null when the data has no list (never built); rejects when the manifest cannot be loaded (network). */
  hskProgress(level: 1 | 2 | 3): Promise<HskProgress | null>
  settings(): Promise<DeckSettings>
  setSettings(patch: Partial<DeckSettings>): Promise<DeckSettings>
  exportData(): Promise<DeckExport>
  importData(json: unknown): Promise<ImportResult>
  subscribe(listener: () => void): () => void
  /** Increases on every change (for useSyncExternalStore). */
  version(): number
}

const META_SETTINGS = 'settings'
const META_PERSIST = 'persistAsked'
const hskKey = (level: number) => `hsk${level}Cursor`

export function createDeck(env: DeckEnv): Deck {
  let storePromise: Promise<ProgressStore> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let version = 0
  const listeners = new Set<() => void>()

  const store = (): Promise<ProgressStore> => {
    storePromise ??= env
      .open(() => {
        storePromise = null
      })
      .catch((err: unknown) => {
        storePromise = null
        // Another tab runs a newer app that upgraded the database: not a storage problem.
        throw (err as { name?: unknown } | null)?.name === 'VersionError' ? new DeckOutdatedError(err) : new DeckStorageError(err)
      })
    return storePromise
  }

  const changed = () => {
    version++
    for (const l of [...listeners]) l()
  }
  env.broadcast?.listen(changed)
  const announce = () => {
    changed()
    env.broadcast?.post()
  }

  /** Runs `fn` after every earlier write has settled. */
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  const settings = async (s: ProgressStore): Promise<DeckSettings> => {
    const saved = await s.getMeta<Partial<DeckSettings>>(META_SETTINGS)
    return { ...DEFAULT_SETTINGS, ...validSettings(saved) }
  }

  const addNow = async (s: ProgressStore, inputs: readonly AddCardInput[]): Promise<AddResult & { chars: string[] }> => {
    const seen = new Set<string>()
    const wanted: AddCardInput[] = []
    const skipped: string[] = []
    for (const input of inputs) {
      if (!input.char || seen.has(input.char)) continue
      seen.add(input.char)
      // Not one Han character: nothing to write, so no stroke data either.
      if (isOneChar(input.char)) wanted.push(input)
      else skipped.push(input.char)
    }
    const writable: AddCardInput[] = []
    const has = await Promise.all(wanted.map((w) => env.strokes.has(w.char)))
    wanted.forEach((w, i) => {
      if (has[i]) writable.push(w)
      else skipped.push(w.char)
    })
    const site = await env.strokes.siteData().catch(() => null)
    const now = env.now()
    // A millisecond apart, so new cards come up in the order they were given (an HSK list's order).
    const records = writable.map((w, i) => newRecord(w, now + i, site?.dataVersion ?? null))
    const { added, existing } = records.length ? await s.addCards(records) : { added: [], existing: [] }
    if (added.length) {
      announce()
      if (env.persist && !(await s.getMeta<boolean>(META_PERSIST))) {
        await s.setMeta(META_PERSIST, true)
        env.persist().catch(() => {})
      }
    }
    return { added: added.length, existing: existing.length, skipped, chars: added.map((c) => c.char) }
  }

  return {
    add: (cards) =>
      exclusive(async () => {
        const { chars: _chars, ...result } = await addNow(await store(), cards)
        return result
      }),

    async has(char) {
      return (await (await store()).getCard(cardId(char))) !== undefined
    },

    async get(char) {
      return (await (await store()).getCard(cardId(char))) ?? null
    },

    remove: (char) =>
      exclusive(async () => {
        await (await store()).deleteCard(cardId(char), env.now())
        announce()
      }),

    async list() {
      return (await store()).allCards()
    },

    // After the writes before it: a session's summary sees every rating it made.
    today: () =>
      exclusive(async () => {
        const s = await store()
        const now = env.now()
        const set = await settings(s)
        const [cards, recent] = await Promise.all([s.allCards(), s.reviewsSince(dayStart(now, set.dayStartHour))])
        const plan = planToday(cards, countIntroduced(recent, now, set.dayStartHour), now, set)
        const item = (flow: StudyItem['flow']) => (c: CardRecord): StudyItem => ({ cardId: c.id, char: c.char, context: c.context, flow })
        return {
          ...plan,
          now,
          dayStartHour: set.dayStartHour,
          total: cards.length,
          due: plan.due.length,
          fresh: plan.fresh.length,
          queue: [...plan.due.map(item('review')), ...plan.fresh.map(item('new'))],
        }
      }),

    review: (id, rating, details) =>
      exclusive(async () => {
        const s = await store()
        const card = await s.getCard(id)
        if (!card) return null
        // The time the schedule uses, and the one logged: never before the card was added or its
        // last review (a clock set back, a file from a device whose clock ran ahead), so a replay of
        // the log — in time order, from `addedAt` on — gives exactly the stored state.
        const at = Math.max(env.now(), card.addedAt, (card.fsrs.lastReview ?? -1) + 1)
        const next: CardRecord = { ...card, fsrs: applyRating(card.fsrs, rating, at) }
        await s.recordReview(next, {
          cardId: id,
          at,
          rating,
          mode: details.mode,
          prevState: card.fsrs.state,
          peeked: details.peeked,
          score: details.score,
          strokeSummary: details.strokeSummary,
          durationMs: Math.max(0, Math.round(details.durationMs)),
        })
        announce()
        return next
      }),

    addNextHsk: (level, count) =>
      exclusive(async () => {
        const s = await store()
        const site = await env.strokes.siteData()
        const list = site?.hskWriting[String(level)] ?? []
        const start = (await s.getMeta<number>(hskKey(level))) ?? 0
        const inDeck = new Set((await s.allCards()).map((c) => c.char))
        const picked: string[] = []
        let cursor = start
        while (cursor < list.length && picked.length < count) {
          const ch = list[cursor++]
          if (!inDeck.has(ch) && (await env.strokes.has(ch))) picked.push(ch)
        }
        const result = await addNow(
          s,
          picked.map((char) => ({ char, context: hskContextOf(site, char) })),
        )
        // Only once the cards are in: a failed add offers the same characters again next time.
        if (cursor !== start) await s.setMeta(hskKey(level), cursor)
        if (!result.added) announce() // the cursor moved: the Today screen shows how many are left
        return result
      }),

    async hskProgress(level) {
      const s = await store()
      const site = await env.strokes.siteData()
      const list = site?.hskWriting[String(level)]
      if (!list?.length) return null
      return { level, cursor: Math.min(list.length, (await s.getMeta<number>(hskKey(level))) ?? 0), total: list.length }
    },

    async settings() {
      return settings(await store())
    },

    setSettings: (patch) =>
      exclusive(async () => {
        const s = await store()
        const next = { ...(await settings(s)), ...validSettings(patch) }
        await s.setMeta(META_SETTINGS, next)
        announce()
        return next
      }),

    async exportData() {
      const s = await store()
      const [cards, reviews, set, removed] = await Promise.all([s.allCards(), s.allReviews(), settings(s), s.getMeta<Removals>(REMOVED_KEY)])
      const hskCursor: Record<string, number> = {}
      for (const level of [1, 2, 3]) {
        const c = await s.getMeta<number>(hskKey(level))
        if (c !== undefined) hskCursor[String(level)] = c
      }
      return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date(env.now()).toISOString(),
        cards,
        reviews: reviews.map(({ id: _id, ...r }) => r),
        meta: { settings: set, hskCursor, removed: removed ?? {} },
      }
    },

    importData: (json) =>
      exclusive(async () => {
        const incoming = parseExport(json, env.now())
        const s = await store()
        const [cards, reviews, removed] = await Promise.all([s.allCards(), s.allReviews(), s.getMeta<Removals>(REMOVED_KEY)])
        const plan = mergePlan(cards, reviews, incoming, removed ?? {})
        if (plan.cards.length || plan.reviews.length || plan.remove.length || plan.removedChanged) {
          await s.merge(plan.cards, plan.reviews, plan.remove, plan.removed)
        }
        for (const [level, cursor] of Object.entries(incoming.hskCursor)) {
          const mine = (await s.getMeta<number>(hskKey(Number(level)))) ?? 0
          if (cursor > mine) await s.setMeta(hskKey(Number(level)), cursor)
        }
        announce()
        return { ...plan.result, skipped: incoming.skipped }
      }),

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    version: () => version,
  }
}

/** The word a quick-added HSK character is learned in (the manifest's hskContext), as a card context. */
function hskContextOf(site: DeckSiteData | null, char: string): CardContext | undefined {
  const c = site?.hskContext?.[char]
  const key = c ? parseKey(c[0]) : null
  if (!c || !key || !key.simp.includes(char)) return undefined
  return { key: c[0], simp: key.simp, pinyin: key.pinyin, vi: c[1], ...(c[2] ? { pn: true } : {}) }
}

function newRecord(input: AddCardInput, now: number, dataVersion: string | null): CardRecord {
  return {
    id: cardId(input.char),
    char: input.char,
    hex: (input.char.codePointAt(0) ?? 0).toString(16),
    addedAt: now,
    context: input.context ? { ...input.context } : null,
    fsrs: newCardState(now),
    dataVersion,
  }
}

function isOneChar(s: string): boolean {
  return s.length > 0 && [...s].length === 1 && /\p{Script=Han}/u.test(s)
}

function validSettings(v: Partial<DeckSettings> | undefined): Partial<DeckSettings> {
  const out: Partial<DeckSettings> = {}
  if (!v) return out
  if (Number.isInteger(v.newPerDay) && v.newPerDay! >= 0 && v.newPerDay! <= 200) out.newPerDay = v.newPerDay
  if (Number.isInteger(v.dayStartHour) && v.dayStartHour! >= 0 && v.dayStartHour! <= 23) out.dayStartHour = v.dayStartHour
  return out
}

// ── Import ─────────────────────────────────────────────────────────────────

const STATES = new Set(['new', 'learning', 'review', 'relearning'])
const RATINGS = new Set(['wrong', 'close', 'correct'])
const MODES = new Set(['new', 'review', 'again'])
const DAY_MS = 86_400_000
/** No deck record is older than this app; an earlier time is a broken clock or a forged file. */
const EARLIEST = Date.UTC(2020, 0, 1)
const CARD_ID = /^c:[0-9a-f]{1,6}#write$/

interface ParsedExport {
  cards: CardRecord[]
  reviews: ReviewRecord[]
  hskCursor: Record<string, number>
  removed: Removals
  skipped: number
}

type TimeCheck = (t: unknown) => t is number

/**
 * Checks an export (any version this app wrote) and keeps its valid records. Times must be real
 * dates from 2020 to a day after the file was exported (or after `now`, if later): a review dated
 * in the year 3000 would otherwise hold its card for good, even after it is removed and added again.
 */
export function parseExport(json: unknown, now: number = Date.now()): ParsedExport {
  if (typeof json !== 'object' || json === null) throw new DeckImportError('Tệp này không phải dữ liệu sổ ôn tập.')
  const data = json as Partial<Record<keyof DeckExport, unknown>>
  if (data.format !== EXPORT_FORMAT) throw new DeckImportError('Tệp này không phải dữ liệu sổ ôn tập.')
  if (data.version !== EXPORT_VERSION)
    throw new DeckImportError('Tệp được xuất từ phiên bản ứng dụng khác, chưa đọc được. Hãy cập nhật ứng dụng rồi thử lại.')
  const exported = typeof data.exportedAt === 'string' ? Date.parse(data.exportedAt) : NaN
  const latest = Math.max(Number.isFinite(exported) ? exported : 0, now) + DAY_MS
  const validTime: TimeCheck = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t >= EARLIEST && t <= latest
  let skipped = 0
  const cards: CardRecord[] = []
  for (const c of Array.isArray(data.cards) ? data.cards : []) {
    const card = validCard(c, validTime)
    if (card) cards.push(card)
    else skipped++
  }
  const reviews: ReviewRecord[] = []
  for (const r of Array.isArray(data.reviews) ? data.reviews : []) {
    const review = validReview(r, validTime)
    if (review) reviews.push(review)
    else skipped++
  }
  const hskCursor: Record<string, number> = {}
  const meta = data.meta as { hskCursor?: Record<string, unknown>; removed?: Record<string, unknown> } | undefined
  for (const [level, v] of Object.entries(meta?.hskCursor ?? {})) {
    if (['1', '2', '3'].includes(level) && Number.isInteger(v) && (v as number) >= 0) hskCursor[level] = v as number
  }
  const removed: Removals = {}
  for (const [id, at] of Object.entries(meta?.removed ?? {})) if (CARD_ID.test(id) && validTime(at)) removed[id] = at
  return { cards, reviews, hskCursor, removed, skipped }
}

function validCard(v: unknown, validTime: TimeCheck): CardRecord | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Partial<CardRecord>
  if (typeof c.char !== 'string' || !isOneChar(c.char) || c.id !== cardId(c.char)) return null
  if (!validTime(c.addedAt)) return null
  const ctx = c.context
  const context =
    ctx && typeof ctx === 'object' && typeof ctx.key === 'string' && typeof ctx.simp === 'string'
      ? { key: ctx.key, simp: ctx.simp, pinyin: String(ctx.pinyin ?? ''), vi: String(ctx.vi ?? ''), ...(ctx.pn === true ? { pn: true } : {}) }
      : null
  return {
    id: c.id,
    char: c.char,
    hex: (c.char.codePointAt(0) ?? 0).toString(16),
    addedAt: c.addedAt,
    context,
    // Recomputed from the log on import (mergePlan): whatever state the file carries is not trusted.
    fsrs: newCardState(c.addedAt),
    dataVersion: typeof c.dataVersion === 'string' ? c.dataVersion : null,
  }
}

const TALLY_KEYS = ['total', 'good', 'off', 'wrong', 'missing', 'extra'] as const

function validReview(v: unknown, validTime: TimeCheck): ReviewRecord | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Partial<ReviewRecord>
  if (typeof r.cardId !== 'string' || !CARD_ID.test(r.cardId)) return null
  if (!validTime(r.at) || !RATINGS.has(r.rating as string)) return null
  return {
    cardId: r.cardId,
    at: r.at,
    rating: r.rating!,
    mode: MODES.has(r.mode as string) ? r.mode! : 'review',
    prevState: STATES.has(r.prevState as string) ? r.prevState! : 'review',
    peeked: r.peeked === true,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? Math.min(100, Math.max(0, r.score)) : null,
    strokeSummary: validTally(r.strokeSummary),
    durationMs: typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) ? Math.min(DAY_MS, Math.max(0, r.durationMs)) : 0,
  }
}

/** Only the counts, each a whole number from 0 to 999: nothing else a file carries is kept. */
function validTally(t: unknown): StrokeTally | null {
  if (typeof t !== 'object' || t === null) return null
  const src = t as Record<string, unknown>
  if (!Number.isInteger(src.total)) return null
  const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) ? Math.min(999, Math.max(0, x)) : 0)
  const [total, good, off, wrong, missing, extra] = TALLY_KEYS.map((k) => count(src[k]))
  return { total, good, off, wrong, missing, extra }
}

/**
 * The union of what is here and what is imported: cards added (an existing one keeps its context
 * and the earlier "added" time), reviews appended unless the same review is already logged, and
 * every card that changed rescheduled from its whole log. Removals are merged as well, the later
 * one per card: a card removed on either side after it was added there stays removed (an old
 * backup does not bring it back), and a card added again after its removal starts afresh.
 */
export function mergePlan(
  mine: readonly CardRecord[],
  myReviews: readonly ReviewRecord[],
  incoming: Pick<ParsedExport, 'cards' | 'reviews'> & { removed?: Removals },
  myRemoved: Removals = {},
): {
  cards: CardRecord[]
  reviews: ReviewRecord[]
  /** Card ids to delete here. */
  remove: string[]
  removed: Removals
  removedChanged: boolean
  result: Omit<ImportResult, 'skipped'>
} {
  const removed: Removals = { ...myRemoved }
  let removedChanged = false
  for (const [id, at] of Object.entries(incoming.removed ?? {})) {
    if (at > (removed[id] ?? -Infinity)) {
      removed[id] = at
      removedChanged = true
    }
  }
  /** Added after the card's last removal: not the one a removal took away. */
  const alive = (c: CardRecord) => c.addedAt > (removed[c.id] ?? -Infinity)
  const cards = new Map(mine.filter(alive).map((c) => [c.id, c]))
  const remove = mine.filter((c) => !alive(c)).map((c) => c.id)
  const touched = new Set<string>()
  let cardsAdded = 0
  let cardsUpdated = 0
  for (const c of incoming.cards) {
    if (!alive(c)) continue
    const here = cards.get(c.id)
    if (!here) {
      cards.set(c.id, c)
      touched.add(c.id)
      cardsAdded++
    } else if (c.addedAt < here.addedAt || (!here.context && c.context)) {
      cards.set(c.id, { ...here, addedAt: Math.min(here.addedAt, c.addedAt), context: here.context ?? c.context })
      touched.add(c.id)
      cardsUpdated++
    }
  }
  const key = (r: ReviewRecord) => `${r.cardId}|${r.at}|${r.rating}`
  const logged = new Set(myReviews.map(key))
  const newReviews: ReviewRecord[] = []
  for (const r of incoming.reviews) {
    if (!cards.has(r.cardId) || logged.has(key(r))) continue
    logged.add(key(r))
    newReviews.push(r)
    touched.add(r.cardId)
  }
  const byCard = new Map<string, ReviewRecord[]>()
  for (const r of [...myReviews, ...newReviews]) {
    if (!touched.has(r.cardId)) continue
    let list = byCard.get(r.cardId)
    if (!list) byCard.set(r.cardId, (list = []))
    list.push(r)
  }
  const updated: CardRecord[] = []
  for (const id of touched) {
    const c = cards.get(id)!
    updated.push({ ...c, fsrs: replay(c.addedAt, byCard.get(id) ?? []) })
  }
  // A card removed here and added again on the other side is replaced (put), not deleted.
  const gone = remove.filter((id) => !cards.has(id))
  return {
    cards: updated,
    reviews: newReviews,
    remove: gone,
    removed,
    removedChanged,
    result: { cardsAdded, cardsUpdated, cardsRemoved: gone.length, reviewsAdded: newReviews.length },
  }
}
