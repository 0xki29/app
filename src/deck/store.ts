import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CardRecord, ReviewRecord } from './types'

/**
 * The learner's progress, on the device: IndexedDB database "chinese-notebook" (version 1) —
 *   cards    one record per card (keyPath id): character, context, FSRS state, when added
 *   reviews  append-only log of self-ratings (auto-increment id; indexes cardId and at)
 *   meta     small values by key: settings, the HSK list cursors, whether persistence was asked
 * The deck (deck.ts) only talks to the ProgressStore interface; the tests run this implementation
 * on fake-indexeddb.
 */

export const DB_NAME = 'chinese-notebook'
/** Meta key of the removals: card id → when it was last removed (epoch ms). */
export const REMOVED_KEY = 'removed'

export type Removals = Record<string, number>
const DB_VERSION = 1

interface ProgressDB extends DBSchema {
  cards: { key: string; value: CardRecord }
  reviews: { key: number; value: ReviewRecord; indexes: { cardId: string; at: number } }
  meta: { key: string; value: unknown }
}

export interface ProgressStore {
  getCard(id: string): Promise<CardRecord | undefined>
  allCards(): Promise<CardRecord[]>
  /** Adds the cards that are not stored yet, in one transaction; says which were already there. */
  addCards(cards: readonly CardRecord[]): Promise<{ added: CardRecord[]; existing: string[] }>
  /**
   * Removes a card; its reviews stay in the log (replay only reads reviews after a card was added).
   * With `removedAt`, the removal is noted in the same transaction (meta REMOVED_KEY), so an import
   * of an older copy does not bring the card back.
   */
  deleteCard(id: string, removedAt?: number): Promise<void>
  /** Stores the card's new state and appends its review, together. */
  recordReview(card: CardRecord, review: ReviewRecord): Promise<void>
  reviewsSince(at: number): Promise<ReviewRecord[]>
  allReviews(): Promise<ReviewRecord[]>
  /** Puts cards (replacing), deletes `remove`, appends reviews and sets the removals, in one transaction (import). */
  merge(cards: readonly CardRecord[], reviews: readonly ReviewRecord[], remove?: readonly string[], removed?: Removals): Promise<void>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  close(): void
}

/**
 * Opens (creating or upgrading) the progress database. Rejects where IndexedDB is unavailable.
 * `onClose`: the connection was closed from outside (another tab upgrading the database, the
 * browser dropping it) — the caller opens a new one for its next request.
 */
export async function openProgressStore(name: string = DB_NAME, onClose?: () => void): Promise<ProgressStore> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available')
  const db: IDBPDatabase<ProgressDB> = await openDB<ProgressDB>(name, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('cards', { keyPath: 'id' })
        const reviews = d.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true })
        reviews.createIndex('cardId', 'cardId')
        reviews.createIndex('at', 'at')
        d.createObjectStore('meta')
      }
    },
    // Another tab opens a newer version: let it (this tab's next request reopens and fails with a
    // VersionError, which the deck reports as "reload the page").
    blocking() {
      db.close()
      onClose?.()
    },
    terminated() {
      onClose?.()
    },
  })

  return {
    getCard: (id) => db.get('cards', id),
    allCards: () => db.getAll('cards'),
    async addCards(cards) {
      const tx = db.transaction('cards', 'readwrite')
      const added: CardRecord[] = []
      const existing: string[] = []
      for (const card of cards) {
        if (await tx.store.getKey(card.id)) existing.push(card.id)
        else {
          await tx.store.add(card)
          added.push(card)
        }
      }
      await tx.done
      return { added, existing }
    },
    async deleteCard(id, removedAt) {
      if (removedAt === undefined) return db.delete('cards', id)
      const tx = db.transaction(['cards', 'meta'], 'readwrite')
      const meta = tx.objectStore('meta')
      const removed = ((await meta.get(REMOVED_KEY)) as Removals | undefined) ?? {}
      await Promise.all([tx.objectStore('cards').delete(id), meta.put({ ...removed, [id]: Math.max(removed[id] ?? 0, removedAt) }, REMOVED_KEY), tx.done])
    },
    async recordReview(card, review) {
      const tx = db.transaction(['cards', 'reviews'], 'readwrite')
      await Promise.all([tx.objectStore('cards').put(card), tx.objectStore('reviews').add(withoutId(review)), tx.done])
    },
    reviewsSince: (at) => db.getAllFromIndex('reviews', 'at', IDBKeyRange.lowerBound(at)),
    allReviews: () => db.getAll('reviews'),
    async merge(cards, reviews, remove = [], removed) {
      const tx = db.transaction(['cards', 'reviews', 'meta'], 'readwrite')
      const c = tx.objectStore('cards')
      const r = tx.objectStore('reviews')
      await Promise.all([
        ...remove.map((id) => c.delete(id)),
        ...cards.map((card) => c.put(card)),
        ...reviews.map((review) => r.add(withoutId(review))),
        ...(removed ? [tx.objectStore('meta').put(removed, REMOVED_KEY)] : []),
        tx.done,
      ])
    },
    getMeta: async <T,>(key: string) => (await db.get('meta', key)) as T | undefined,
    setMeta: async (key, value) => {
      await db.put('meta', value, key)
    },
    close: () => db.close(),
  }
}

/** The log assigns ids: a record from elsewhere (an import) never overwrites one. */
function withoutId(review: ReviewRecord): ReviewRecord {
  const { id: _id, ...rest } = review
  return rest
}
