import type { Rating } from '../workspace/attempt'

/**
 * The review deck's records, as stored in IndexedDB and in an export. Plain JSON (times are epoch
 * ms), so a record survives structured clone, export and import unchanged.
 */

/** The learner's own verdict after Recall: Sai → FSRS Again, Gần đúng → Hard, Đúng → Good (scheduler.ts). */
export type SelfRating = Rating

/** FSRS's card states, by name (ts-fsrs numbers them). */
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

/** A card's FSRS memory state (ts-fsrs `Card`, JSON-safe). */
export interface FsrsCardState {
  due: number
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: CardState
  lastReview: number | null
}

/** The word a card was added from: shown in its prompt, the character masked in Recall (学 in 学生 → "＿生"). */
export interface CardContext {
  /** The dictionary entry's stable key, "trad|simp[numbered pinyin]". */
  key: string
  simp: string
  /** CC-CEDICT numbered pinyin of the word. */
  pinyin: string
  /** The word's first Vietnamese sense (or English, when it has none). */
  vi: string
  /** The word is a proper noun (中国): its capital names the word, not the character (practiceItem.ts). */
  pn?: boolean
}

/** One writing card: a character to write from memory. */
export interface CardRecord {
  /** "c:<hex code point>#write". */
  id: string
  char: string
  /** Lowercase hex code point (the stroke file's name). */
  hex: string
  addedAt: number
  context: CardContext | null
  fsrs: FsrsCardState
  /** The dictionary data version the card was added under (null when unknown). */
  dataVersion: string | null
}

/** How the rated turn went in the session: a new card (Xem → Tô theo → Nhớ lại), a due review (Nhớ lại), or a card re-queued after "Sai". */
export type ReviewMode = 'new' | 'review' | 'again'

/** The stroke-by-stroke check, counted (logged alongside the rating; it does not drive the schedule). */
export interface StrokeTally {
  total: number
  good: number
  off: number
  wrong: number
  missing: number
  extra: number
}

/** One self-rating: the review log is append-only, and the FSRS state can be recomputed from it (scheduler.replay). */
export interface ReviewRecord {
  /** Assigned by the store. */
  id?: number
  cardId: string
  at: number
  rating: SelfRating
  mode: ReviewMode
  /** The card's state before this review (a 'new' one means the card was introduced then). */
  prevState: CardState
  /** The learner saw the answer (Recall revealed it, or they asked to see the character) before this rating. */
  peeked?: boolean
  /** The automatic shape score of the rated attempt (0–100), for the record only. */
  score?: number | null
  strokeSummary?: StrokeTally | null
  /** From the card appearing on screen to the rating. */
  durationMs: number
}

export interface DeckSettings {
  /** New cards introduced per learning day. */
  newPerDay: number
  /** Local hour at which a learning day starts (a review done at 1 a.m. still counts for the day before). */
  dayStartHour: number
}

export const DEFAULT_SETTINGS: DeckSettings = { newPerDay: 10, dayStartHour: 4 }

/** The id of a character's writing card. */
export function cardId(char: string): string {
  return `c:${(char.codePointAt(0) ?? 0).toString(16)}#write`
}
