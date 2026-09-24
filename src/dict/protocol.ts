import type { CharInfo, DictEntry, DictMeta, DictStatus, SearchResult } from './types'

/** Messages between the dictionary client (page) and its worker. Every request gets one reply. */

export interface WordChar {
  char: string
  /** Numbered pinyin of this character in the word ('sheng5'), or '' when it cannot be aligned. */
  reading: string
  /** Âm Hán Việt of this character in the word ('sinh'), or its own entry's. */
  hv: string
  /** The character's own entry for that reading (else its most common one), or null. */
  entry: DictEntry | null
  hasStrokes: boolean
  /** The traditional form at the same place in the word, when it differs (学 → 學). */
  trad: string | null
  tradHasStrokes: boolean
}

export interface WordDetail {
  entry: DictEntry
  /** Distinct Han characters of the simplified form, in order. */
  chars: WordChar[]
  /** Other entries written the same way (a single character's other readings: 行 xíng / háng). */
  sameForm: DictEntry[]
  /**
   * No more common entry written the same way is read differently. When false (行 háng), a voice
   * reading the hanzi alone will likely say the usual reading (xíng) instead.
   */
  usualReading: boolean
  /** The rest of the dictionary is still loading: `sameForm` may miss a rare reading. */
  partial: boolean
}

export interface MetaReply extends DictMeta {
  hskWriting: Record<string, string[]>
  /** Every character with stroke data, concatenated; null when the list could not be loaded. */
  available: string | null
}

export type Request =
  | { type: 'search'; q: string; limit: number }
  | { type: 'entry'; key: string }
  | { type: 'word'; key: string }
  | { type: 'charInfo'; ch: string }
  | { type: 'meta' }

export interface ReplyOf {
  search: SearchResult
  entry: DictEntry | null
  word: WordDetail | null
  charInfo: CharInfo | null
  meta: MetaReply
}

export type ToWorker =
  | { type: 'init'; manifestUrl: string; siteUrl: string }
  | { type: 'ensure' }
  | { type: 'request'; id: number; req: Request }

export type FromWorker =
  | { type: 'status'; status: DictStatus }
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string; noData?: boolean }
