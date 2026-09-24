import { FOLD_SKIP, foldCode, foldIY, foldKey, hasDiacritics, isPinyinOnly, isVietnameseOnly, toneKey } from './normalize'
import { isConstrained, parsePinyinQuery, pinyinKey, pinyinMatch, type PinyinKey } from './pinyin'
import { COL, FLAG_BITS, flagBits, parseKey, rowToEntry } from './row'
import type { DictEntry, MatchKind } from './types'

/**
 * The dictionary's search index: plain TypeScript with no DOM or Node APIs, built in the worker
 * from the shard texts (rows in rank order, so a row's id is its rank: lower = more common).
 *
 *   hanzi    sorted simplified and traditional keys (exact, prefix) + per-character postings (contains)
 *   pinyin   sorted toneless keys ('xuesheng'); typed tones and boundaries filter, never segment
 *   hanviet  sorted folded readings, primary and alternates ('hoc sinh')
 *   meaning  folded word postings + whole-gloss postings, Vietnamese; English only for rows that have
 *            no Vietnamese (flag 'en'), in their own index, weighted lower
 *
 * Score = match tier + popularity (0..100); ties go to the more common row.
 *   hanzi    exact 1000 · prefix 800 · contains 500
 *   pinyin   exact 900 · prefix at a syllable end 600, inside a syllable 560; −20 when the entry's
 *            neutral tone had to stand in for a typed tone; ü typed as u −20; if the typed tones match
 *            nothing, toneless results come back at 450 / 300
 *   hanviet  exact 900 · prefix 600 (whole syllables) / 560; typed diacritics: 915 / 615 when they
 *            match, 590 / 450 when only the folded form does; an alternate reading −10
 *   meaning  a gloss equal to the query 850 · starting with it 700 · containing it 550 · a word
 *            starting with it 400 · all words somewhere 300; +10 in the first sense, −15 per sense
 *            after it (at most −45); Vietnamese +20 (+40 / +25 when typed diacritics match; a
 *            gloss whose diacritics differ from the typed ones falls to 300); English −300.
 *            A gloss that is a pattern ("người …") counts as containing the query (550), one a note
 *            or a label narrows ("uống (thuốc)", "(miệt thị) Hàn Quốc") as starting with it (700). A phrase (several words) equal to
 *            a Vietnamese gloss +50, so "xin chao" is 你好 before the pinyin xīn cháo. A leading
 *            classifier (cái, con, chiếc…) is optional: "con lợn" also searches "lợn", −15.
 *   variant-form rows −150 unless the hanzi match exactly
 *
 * The query is cleaned first: NFKC (full-width Latin), punctuation, symbols and emoji dropped; with
 * hanzi in it, only its Han runs are searched (学sheng → 学).
 */

export const INDEX_FORMAT = 1

const HAN = /\p{Script=Han}/u
const HAN_G = /\p{Script=Han}/gu
const HAN_RUN = /\p{Script=Han}+/gu
const VAR = FLAG_BITS.var

/** Rows scored per meaning query (most common first), besides every row with a gloss equal to the query. */
const MEANING_CAP = 600
const PREFIX_CAP = 500
const CONTAINS_CAP = 300
/** Keys scanned for one prefix before giving up (a one-letter query). */
const SCAN_CAP = 20000

export interface RawHit {
  id: number
  score: number
  kind: MatchKind
  /** Meaning hits: index of the matched sense; else -1. */
  sense: number
  lang?: 'vi' | 'en'
}

export interface IndexResult {
  hits: RawHit[]
  groups: { kind: MatchKind; hits: RawHit[]; total: number }[] | null
}

const KINDS: readonly MatchKind[] = ['hanzi', 'pinyin', 'hanviet', 'meaning']

// ── Building blocks ───────────────────────────────────────────────────────────

function lowerBound(keys: readonly string[], k: string): number {
  let lo = 0
  let hi = keys.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (keys[m] < k) lo = m + 1
    else hi = m
  }
  return lo
}

/** Comparisons (or copies) between two yields of the sliced building steps. */
const STEP = 20000

/**
 * The order that sorts `keys` (stable, so equal keys keep their ids ascending), as a bottom-up
 * merge sort that yields every STEP operations: sorting 140k keys in one go would stall the worker
 * (and every search waiting on it) for most of a second on a phone.
 */
function* sortOrder(keys: readonly string[]): Generator<void, Int32Array> {
  const n = keys.length
  let src = new Int32Array(n)
  let dst = new Int32Array(n)
  for (let i = 0; i < n; i++) src[i] = i
  let ops = 0
  const RUN = 16
  for (let lo = 0; lo < n; lo += RUN) {
    const hi = Math.min(lo + RUN, n)
    for (let i = lo + 1; i < hi; i++) {
      const v = src[i]
      const kv = keys[v]
      let j = i - 1
      while (j >= lo && keys[src[j]] > kv) {
        src[j + 1] = src[j]
        j--
      }
      src[j + 1] = v
    }
    ops += RUN * 4
    if (ops > STEP) {
      ops = 0
      yield
    }
  }
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n)
      const hi = Math.min(lo + 2 * width, n)
      let i = lo
      let j = mid
      let k = lo
      while (i < mid && j < hi) {
        dst[k++] = keys[src[j]] < keys[src[i]] ? src[j++] : src[i++]
        if (++ops > STEP) {
          ops = 0
          yield
        }
      }
      while (i < mid) dst[k++] = src[i++]
      while (j < hi) dst[k++] = src[j++]
    }
    const t = src
    src = dst
    dst = t
  }
  return src
}

/** Keys added in id order, not yet sorted (the builder's side of SortedKeys). */
class KeyList {
  keys: string[] = []
  ids: number[] = []

  add(key: string, id: number): void {
    this.keys.push(key)
    this.ids.push(id)
  }
}

/** Sorted keys with a parallel id per key (a row appears once per distinct key). */
class SortedKeys {
  constructor(
    readonly keys: string[],
    readonly ids: Int32Array,
  ) {}

  static *build(list: KeyList): Generator<void, SortedKeys> {
    const order = yield* sortOrder(list.keys)
    const n = order.length
    const keys: string[] = new Array<string>(n)
    const ids = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      keys[i] = list.keys[order[i]]
      ids[i] = list.ids[order[i]]
      if (i % STEP === STEP - 1) yield
    }
    return new SortedKeys(keys, ids)
  }

  first(k: string): number {
    return lowerBound(this.keys, k)
  }

  /** Ids whose key is exactly `k`, most common first. */
  exact(k: string): number[] {
    const out: number[] = []
    for (let i = this.first(k); i < this.keys.length && this.keys[i] === k; i++) out.push(this.ids[i])
    return out
  }
}

/** token → sorted ids, flat: tokens sorted, ids of token i in ids[offs[i] .. offs[i + 1]). */
class Postings {
  constructor(
    readonly tokens: string[],
    readonly offs: Int32Array,
    readonly ids: Int32Array,
  ) {}

  static *build(map: Map<string, number[]>): Generator<void, Postings> {
    const unsorted = [...map.keys()]
    const order = yield* sortOrder(unsorted)
    const tokens: string[] = new Array<string>(order.length)
    const lists: number[][] = new Array<number[]>(order.length)
    const offs = new Int32Array(order.length + 1)
    let n = 0
    for (let i = 0; i < order.length; i++) {
      tokens[i] = unsorted[order[i]]
      lists[i] = map.get(tokens[i])!
      offs[i] = n
      n += lists[i].length
      if (i % STEP === STEP - 1) yield
    }
    offs[order.length] = n
    const ids = new Int32Array(n)
    let copied = 0
    for (let i = 0; i < lists.length; i++) {
      ids.set(lists[i], offs[i])
      copied += lists[i].length
      if (copied > STEP * 5) {
        copied = 0
        yield
      }
    }
    return new Postings(tokens, offs, ids)
  }

  get(tok: string): Int32Array | null {
    const i = lowerBound(this.tokens, tok)
    return this.tokens[i] === tok ? this.ids.subarray(this.offs[i], this.offs[i + 1]) : null
  }

  /** Ids of the tokens starting with `pre` (at most `maxTokens` tokens), sorted, distinct. */
  prefixUnion(pre: string, maxTokens = 30): Int32Array | null {
    const lo = lowerBound(this.tokens, pre)
    let hi = lo
    while (hi < this.tokens.length && hi - lo < maxTokens && this.tokens[hi].startsWith(pre)) hi++
    if (hi === lo) return null
    if (hi - lo === 1) return this.ids.subarray(this.offs[lo], this.offs[lo + 1])
    return Int32Array.from(new Set(this.ids.subarray(this.offs[lo], this.offs[hi]))).sort()
  }
}

function intersectSorted(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i])
      i++
      j++
    } else if (a[i] < b[j]) i++
    else j++
  }
  return out
}

function addPosting(map: Map<string, number[]>, tok: string, id: number): void {
  const a = map.get(tok)
  if (!a) map.set(tok, [id])
  else if (a[a.length - 1] !== id) a.push(id)
}

const isOpen = (c: number) => c === 0x28 || c === 0xff08 // ( \uff08
const isClose = (c: number) => c === 0x29 || c === 0xff09

/**
 * One pass over a meaning column: every word (folded, i/y folded) into `words`, and every whole
 * gloss into `glosses` — senses split on '/', glosses on ';' outside parentheses, notes in
 * parentheses left out of the gloss (their words still count). Pinyin in brackets ([liao3]) and
 * classifier senses are skipped. Must agree with senseGlosses.
 */
function scanMeaning(text: string, id: number, words: Map<string, number[]>, glosses: Map<string, number[]>): void {
  let word = ''
  let gloss = ''
  let depth = 0
  let bracket = false
  for (let i = 0; i <= text.length; i++) {
    // A classifier sense ("Lượng từ: 个 (gè)") is not a meaning: its words would match "lượng tử".
    if ((i === 0 || text.charCodeAt(i - 1) === 0x2f) && CLASSIFIER.test(text.slice(i, i + 12))) {
      const next = text.indexOf('/', i)
      if (next < 0) i = text.length
      else {
        i = next
        continue
      }
    }
    const c = i < text.length ? text.charCodeAt(i) : 0x2f
    if (bracket) {
      if (c === 0x5d) bracket = false
      if (c !== 0x2f) continue
    }
    const f = foldCode(c)
    if (f === FOLD_SKIP) continue
    if (f) {
      word += String.fromCharCode(f)
      continue
    }
    if (word) {
      const w = foldIY(word)
      addPosting(words, w, id)
      if (depth === 0) gloss = gloss ? `${gloss} ${w}` : w
      word = ''
    }
    if (c === 0x5b) bracket = true
    else if (isOpen(c)) depth++
    else if (isClose(c)) {
      if (depth) depth--
    } else if (c === 0x2f || (c === 0x3b && depth === 0)) {
      if (gloss && gloss.length < 40) addPosting(glosses, gloss, id)
      gloss = ''
      if (c === 0x2f) {
        depth = 0
        bracket = false
      }
    }
  }
}

/**
 * The glosses of one sense as they are compared with the query: split on ';' outside parentheses,
 * with parenthesized notes and bracketed pinyin left out. `narrowed`: a note right after the gloss's
 * words restricts it ("uống (thuốc)", "ăn (tết)"), and a label before the sense restricts all of
 * its glosses ("(miệt thị) Hàn Quốc", "(sau số đếm) giờ", "(y học) gây mê") — an example
 * ("(vd. …)") does not, nor a label of plain register ("(khẩu ngữ) ngửi" is the word itself).
 */
export function senseGlossParts(sense: string): { plain: string; narrowed: boolean }[] {
  const out: { plain: string; narrowed: boolean }[] = []
  const lead = /^\s*[(（]\s*/.exec(sense)
  const labelText = lead ? sense.slice(lead[0].length, lead[0].length + 12) : ''
  const labelled = !!lead && !EXAMPLE_NOTE.test(labelText) && !PLAIN_REGISTER.test(labelText)
  let cur = ''
  let narrowed = labelled
  let depth = 0
  let bracket = false
  for (let i = 0; i < sense.length; i++) {
    const c = sense.charCodeAt(i)
    if (bracket) {
      if (c === 0x5d) bracket = false
      continue
    }
    if (c === 0x5b) bracket = true
    else if (isOpen(c)) {
      if (depth === 0 && cur.trim() && !EXAMPLE_NOTE.test(sense.slice(i + 1, i + 9))) narrowed = true
      depth++
      cur += ' '
    } else if (isClose(c)) {
      if (depth) depth--
    } else if (depth) continue
    else if (c === 0x3b) {
      out.push({ plain: cur, narrowed })
      cur = ''
      narrowed = labelled
    } else cur += sense[i]
  }
  out.push({ plain: cur, narrowed })
  return out
}

/** senseGlossParts, the text only. */
export function senseGlosses(sense: string): string[] {
  return senseGlossParts(sense).map((g) => g.plain)
}

const CLASSIFIER = /^\s*(lượng từ|lt|cl)\s*:/i
const EXAMPLE_NOTE = /^\s*(?:vd\.|ví dụ|e\.g\.)/i
/** Register labels that leave a gloss the plain word: colloquial, written, polite. */
const PLAIN_REGISTER = /^(?:khẩu ngữ|văn nói|văn viết|thông tục|trang trọng|lịch sự|kính ngữ|thân mật)/i
/** Vietnamese classifiers a learner may type before a noun ("con lợn", "cái bút"), folded. */
const VI_CLASSIFIERS = new Set(['cai', 'con', 'chiec', 'qua', 'trai', 'quyen', 'cuon', 'to', 'cay', 'bo', 'doi', 'ngoi', 'toa', 'buc', 'tam', 'canh', 'bong', 'soi', 'hat', 'cu', 'mon'])

interface Gloss {
  /** Index of its sense in the column. */
  sense: number
  /** The gloss without notes, as written. */
  plain: string
  /** foldKey(plain). */
  core: string
  /** A note right after it narrows it (senseGlossParts). */
  narrowed: boolean
  /** A pattern with a gap ("người …"), not a word. */
  pattern: boolean
  /** toneKey(plain), computed when typed diacritics need it. */
  tone?: string
}

/** NFKC (full-width Latin), punctuation, symbols and emoji dropped; the apostrophe, colon and middle dot pinyin uses kept. */
export function cleanQuery(query: string): string {
  return query
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\p{Cf}︎️]/gu, (c) => ("'’:·".includes(c) ? c : ' '))
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
}

interface Shard {
  from: number
  text: string
  /** Start offset of each line, plus one past the end (length rows + 1). */
  starts: Int32Array
}

function lineStarts(text: string): Int32Array {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  // A final newline ends the last row; it does not start another.
  if (starts[starts.length - 1] === text.length) starts.pop()
  starts.push(text.length + 1)
  return Int32Array.from(starts)
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds the index shard by shard. `addShard` and `finish` are generators that yield every few
 * dozen rows (or thousand comparisons), so the worker can answer searches between slices while the
 * rest of the dictionary is added. `finish` does not consume the builder: add more shards, then finish again (core first,
 * then everything).
 */
export class IndexBuilder {
  private shards: Shard[] = []
  private n = 0
  private pop: number[] = []
  private flags: number[] = []
  private hsk: number[] = []
  private py: string[] = []
  private simpK = new KeyList()
  private tradK = new KeyList()
  private pyK = new KeyList()
  private pyAltK = new KeyList()
  private hvK = new KeyList()
  private charM = new Map<string, number[]>()
  private viM = new Map<string, number[]>()
  private viG = new Map<string, number[]>()
  private enM = new Map<string, number[]>()
  private enG = new Map<string, number[]>()

  get size(): number {
    return this.n
  }

  /** Adds one shard (rows `from`..); `from` must be the number of rows added so far. */
  *addShard(text: string, from: number): Generator<void, void> {
    if (from !== this.n) throw new Error(`shard starts at row ${from}, expected ${this.n}`)
    const starts = lineStarts(text)
    this.shards.push({ from, text, starts })
    const rows = starts.length - 1
    for (let r = 0; r < rows; r++) {
      this.addRow(text.slice(starts[r], starts[r + 1] - 1), this.n)
      this.n++
      if ((r & 63) === 63) yield
    }
  }

  private addRow(raw: string, id: number): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw // tolerate CRLF
    const f = line.split('\t')
    const simp = f[COL.simp]
    const trad = f[COL.trad] || simp
    this.simpK.add(simp, id)
    if (trad !== simp) this.tradK.add(trad, id)
    for (const c of (trad === simp ? simp : simp + trad).match(HAN_G) ?? []) addPosting(this.charM, c, id)

    this.py[id] = f[COL.pinyin] ?? ''
    const py = pinyinKey(this.py[id]).key
    if (py) {
      this.pyK.add(py, id)
      if (py.includes('v')) this.pyAltK.add(py.replace(/v/g, 'u'), id)
    }

    const hv = f[COL.hv] ?? ''
    const alts = f[COL.hvAlt] ?? ''
    let first = ''
    for (const r of alts ? [hv, ...alts.split('|')] : [hv]) {
      if (!r || r === '-') continue
      const k = foldKey(r)
      if (k && k !== first) this.hvK.add(k, id)
      if (!first) first = k
    }

    const vi = f[COL.vi]
    if (vi) scanMeaning(vi, id, this.viM, this.viG)
    else if (f[COL.en]) scanMeaning(f[COL.en], id, this.enM, this.enG)

    this.pop[id] = Math.max(0, Math.min(100, Number(f[COL.pop]) || 0))
    this.flags[id] = flagBits(f[COL.flags] ?? '')
    this.hsk[id] = Number(f[COL.hsk]) || 0
  }

  /** The index of every row added so far. */
  *finish(): Generator<void, DictIndex> {
    const d = new DictIndex()
    d.shards = this.shards.slice()
    d.pop = Uint8Array.from(this.pop)
    d.flags = Uint16Array.from(this.flags)
    d.hsk = Uint8Array.from(this.hsk)
    d.py = this.py.slice()
    yield
    // Each structure is built in slices (see sortOrder).
    d.simpK = yield* SortedKeys.build(this.simpK)
    d.tradK = yield* SortedKeys.build(this.tradK)
    d.pyK = yield* SortedKeys.build(this.pyK)
    d.pyAltK = yield* SortedKeys.build(this.pyAltK)
    d.hvK = yield* SortedKeys.build(this.hvK)
    d.charP = yield* Postings.build(this.charM)
    d.viP = yield* Postings.build(this.viM)
    d.viG = yield* Postings.build(this.viG)
    d.enP = yield* Postings.build(this.enM)
    d.enG = yield* Postings.build(this.enG)
    return d
  }
}

/** Runs a builder generator to completion, without yielding (tests, small data). */
export function runSync<T>(gen: Generator<void, T>): T {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/** Builds the index of whole shard texts at once. */
export function buildIndex(texts: readonly string[]): DictIndex {
  const b = new IndexBuilder()
  for (const t of texts) runSync(b.addShard(t, b.size))
  return runSync(b.finish())
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

interface KeysPart {
  keys: string
  ids: Int32Array
}
interface PostingsPart {
  tokens: string
  offs: Int32Array
  ids: Int32Array
}

/** A structured-cloneable copy of the index (strings and typed arrays), for IndexedDB. */
export interface IndexParts {
  format: number
  shards: { from: number; text: string; starts: Int32Array }[]
  pop: Uint8Array
  flags: Uint16Array
  hsk: Uint8Array
  /** Numbered pinyin per row, '\n'-joined. */
  py: string
  keys: Record<'simpK' | 'tradK' | 'pyK' | 'pyAltK' | 'hvK', KeysPart>
  postings: Record<'charP' | 'viP' | 'viG' | 'enP' | 'enG', PostingsPart>
}

const splitLines = (s: string) => (s ? s.split('\n') : [])

// ── Index ─────────────────────────────────────────────────────────────────────

type Hit = (kind: MatchKind, id: number, tier: number, sense?: number, lang?: 'vi' | 'en') => void

export class DictIndex {
  shards: Shard[] = []
  pop: Uint8Array = new Uint8Array(0)
  flags: Uint16Array = new Uint16Array(0)
  hsk: Uint8Array = new Uint8Array(0)
  /** Numbered pinyin per row (checked for typed tones without splitting the row). */
  py: string[] = []
  simpK = new SortedKeys([], new Int32Array(0))
  tradK = new SortedKeys([], new Int32Array(0))
  pyK = new SortedKeys([], new Int32Array(0))
  pyAltK = new SortedKeys([], new Int32Array(0))
  hvK = new SortedKeys([], new Int32Array(0))
  charP = new Postings([], new Int32Array(1), new Int32Array(0))
  viP = new Postings([], new Int32Array(1), new Int32Array(0))
  viG = new Postings([], new Int32Array(1), new Int32Array(0))
  enP = new Postings([], new Int32Array(1), new Int32Array(0))
  enG = new Postings([], new Int32Array(1), new Int32Array(0))
  private cache = new Map<number, string[]>()
  /** A row's glosses as the meaning search compares them, kept across the searches of one typing. */
  private glossCache = new Map<number, Gloss[]>()

  get size(): number {
    return this.pop.length
  }

  toParts(): IndexParts {
    const k = (s: SortedKeys): KeysPart => ({ keys: s.keys.join('\n'), ids: s.ids })
    const p = (s: Postings): PostingsPart => ({ tokens: s.tokens.join('\n'), offs: s.offs, ids: s.ids })
    return {
      format: INDEX_FORMAT,
      shards: this.shards.map((s) => ({ from: s.from, text: s.text, starts: s.starts })),
      pop: this.pop,
      flags: this.flags,
      hsk: this.hsk,
      py: this.py.join('\n'),
      keys: { simpK: k(this.simpK), tradK: k(this.tradK), pyK: k(this.pyK), pyAltK: k(this.pyAltK), hvK: k(this.hvK) },
      postings: { charP: p(this.charP), viP: p(this.viP), viG: p(this.viG), enP: p(this.enP), enG: p(this.enG) },
    }
  }

  static fromParts(o: IndexParts): DictIndex {
    if (o.format !== INDEX_FORMAT) throw new Error(`index format ${o.format}, expected ${INDEX_FORMAT}`)
    const d = new DictIndex()
    const k = (s: KeysPart) => new SortedKeys(splitLines(s.keys), s.ids)
    const p = (s: PostingsPart) => new Postings(splitLines(s.tokens), s.offs, s.ids)
    d.shards = o.shards.map((s) => ({ ...s }))
    d.pop = o.pop
    d.flags = o.flags
    d.hsk = o.hsk
    d.py = o.py.split('\n')
    d.simpK = k(o.keys.simpK)
    d.tradK = k(o.keys.tradK)
    d.pyK = k(o.keys.pyK)
    d.pyAltK = k(o.keys.pyAltK)
    d.hvK = k(o.keys.hvK)
    d.charP = p(o.postings.charP)
    d.viP = p(o.postings.viP)
    d.viG = p(o.postings.viG)
    d.enP = p(o.postings.enP)
    d.enG = p(o.postings.enG)
    return d
  }

  /** The row's columns (cached). */
  row(id: number): string[] {
    let r = this.cache.get(id)
    if (!r) {
      let s = this.shards[this.shards.length - 1]
      for (let i = this.shards.length - 1; i > 0 && s.from > id; i--) s = this.shards[i - 1]
      const local = id - s.from
      const line = s.text.slice(s.starts[local], s.starts[local + 1] - 1)
      r = (line.endsWith('\r') ? line.slice(0, -1) : line).split('\t')
      if (this.cache.size > 20000) this.cache.clear()
      this.cache.set(id, r)
    }
    return r
  }

  /** The glosses of a row's meaning column (classifier senses left out), folded once. */
  private glossesOf(id: number, col: number): Gloss[] {
    const key = col === COL.vi ? id : -1 - id
    let out = this.glossCache.get(key)
    if (!out) {
      out = []
      const text = this.row(id)[col]
      if (text) {
        const senses = text.split('/')
        for (let si = 0; si < senses.length; si++) {
          if (CLASSIFIER.test(senses[si])) continue
          for (const { plain, narrowed } of senseGlossParts(senses[si])) {
            out.push({ sense: si, plain, core: foldKey(plain), narrowed, pattern: /…|\.\.\./.test(plain) })
          }
        }
      }
      if (this.glossCache.size > 30000) this.glossCache.clear()
      this.glossCache.set(key, out)
    }
    return out
  }

  entry(id: number): DictEntry {
    return rowToEntry(this.row(id))
  }

  /** The row of an entry key, or -1. Lenient, for keys kept from an older data version and cross-references. */
  findKey(key: string): number {
    const p = parseKey(key)
    if (!p) return -1
    const bySimp = this.simpK.exact(p.simp)
    const trad = (id: number) => this.row(id)[COL.trad] || this.row(id)[COL.simp]
    const py = (id: number) => this.py[id]
    const lower = p.pinyin.toLowerCase()
    return (
      bySimp.find((id) => trad(id) === p.trad && py(id) === p.pinyin) ??
      bySimp.find((id) => trad(id) === p.trad && py(id).toLowerCase() === lower) ??
      bySimp.find((id) => py(id) === p.pinyin) ??
      // A cross-reference written with one form only, which is the traditional one: 學生[xue2 sheng5].
      this.tradK.exact(p.trad).find((id) => py(id) === p.pinyin) ??
      -1
    )
  }

  /** Single-character rows for `ch`, as simplified or as traditional, most common first. */
  charRows(ch: string): number[] {
    return [...new Set([...this.simpK.exact(ch), ...this.tradK.exact(ch)])].sort((a, b) => a - b)
  }

  search(query: string, limit = 50, groupLimit = 30): IndexResult {
    const q = cleanQuery(query)
    const maps: Record<MatchKind, Map<number, RawHit>> = {
      hanzi: new Map(),
      pinyin: new Map(),
      hanviet: new Map(),
      meaning: new Map(),
    }
    if (!q) return { hits: [], groups: null }
    const hit: Hit = (kind, id, tier, sense = -1, lang) => {
      let score = tier + this.pop[id]
      if (this.flags[id] & VAR && !(kind === 'hanzi' && tier >= 1000)) score -= 150
      const m = maps[kind]
      const b = m.get(id)
      if (!b || b.score < score) m.set(id, { id, score, kind, sense, lang })
    }
    const latin = !HAN.test(q)
    if (!latin) {
      // As typed without spaces (学 生, T恤, 卡拉OK); if that finds nothing, only the hanzi, their
      // runs joined (学sheng → 学), then the first run (学生 老师 → 学生).
      const compact = q.replace(/\s/g, '')
      const runs = q.match(HAN_RUN) ?? []
      this.searchHanzi(compact, hit)
      if (maps.hanzi.size === 0 && runs.join('') !== compact) this.searchHanzi(runs.join(''), hit)
      if (maps.hanzi.size === 0 && runs.length > 1) this.searchHanzi(runs[0] ?? '', hit)
    } else {
      if (!isVietnameseOnly(q)) this.searchPinyin(q, hit)
      if (!isPinyinOnly(q)) {
        this.searchHanViet(q, hit)
        this.searchMeaning(q, hit)
      }
    }

    const byScore = (a: RawHit, b: RawHit) => b.score - a.score || a.id - b.id
    const merged = new Map<number, RawHit>()
    for (const kind of KINDS) {
      for (const h of maps[kind].values()) {
        const b = merged.get(h.id)
        if (!b || b.score < h.score) merged.set(h.id, h)
      }
    }
    const hits = [...merged.values()].sort(byScore).slice(0, limit)
    const used = KINDS.filter((k) => maps[k].size > 0)
    let groups: IndexResult['groups'] = null
    if (latin && !q.includes(' ') && used.length > 1) {
      groups = used.map((kind) => {
        const all = [...maps[kind].values()].sort(byScore)
        return { kind, hits: all.slice(0, groupLimit), total: all.length }
      })
      // Best group first; equal ones in the fixed order (Chữ Hán, Pinyin, Hán Việt, Nghĩa).
      groups.sort((a, b) => b.hits[0].score - a.hits[0].score || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
    }
    return { hits, groups }
  }

  private searchHanzi(q: string, hit: Hit): void {
    for (const keys of [this.simpK, this.tradK]) {
      const prefix: number[] = []
      const lo = keys.first(q)
      for (let i = lo; i < keys.keys.length && i - lo < SCAN_CAP && keys.keys[i].startsWith(q); i++) {
        if (keys.keys[i].length === q.length) hit('hanzi', keys.ids[i], 1000)
        else prefix.push(keys.ids[i])
      }
      prefix.sort((a, b) => a - b)
      for (const id of prefix.slice(0, PREFIX_CAP)) hit('hanzi', id, 800)
    }
    let post: ArrayLike<number> | null = null
    for (const c of new Set(q.match(HAN_G) ?? [])) {
      const p = this.charP.get(c)
      if (!p) return
      post = post ? intersectSorted(post, p) : p
    }
    if (!post) return
    let taken = 0
    for (let i = 0; i < post.length && taken < CONTAINS_CAP; i++) {
      const f = this.row(post[i])
      if (f[COL.simp].includes(q) || f[COL.trad].includes(q)) {
        hit('hanzi', post[i], 500)
        taken++
      }
    }
  }

  private searchPinyin(q: string, hit: Hit): void {
    const pq = parsePinyinQuery(q)
    if (!pq) return
    const constrained = isConstrained(pq)
    const sylCache = new Map<number, PinyinKey>()
    const syl = (id: number) => {
      let s = sylCache.get(id)
      if (!s) sylCache.set(id, (s = pinyinKey(this.py[id])))
      return s
    }
    const exact: [number, number][] = []
    const prefix: [number, number][] = []
    for (const [keys, penalty] of [
      [this.pyK, 0],
      [this.pyAltK, 20],
    ] as const) {
      const lo = keys.first(pq.key)
      for (let i = lo; i < keys.keys.length && i - lo < SCAN_CAP && keys.keys[i].startsWith(pq.key); i++) {
        ;(keys.keys[i].length === pq.key.length ? exact : prefix).push([keys.ids[i], penalty])
      }
    }
    prefix.sort((a, b) => a[0] - b[0])
    let any = false
    for (const [id, penalty] of exact) {
      const m = constrained ? pinyinMatch(pq, syl(id)) : 2
      if (m) {
        hit('pinyin', id, (m === 2 ? 900 : 880) - penalty)
        any = true
      }
    }
    let taken = 0
    for (const [id, penalty] of prefix) {
      if (taken >= PREFIX_CAP) break
      const s = syl(id)
      const m = constrained ? pinyinMatch(pq, s) : 2
      if (!m) continue
      const tier = s.ends.includes(pq.key.length) ? 600 : 560
      hit('pinyin', id, tier - (m === 2 ? 0 : 20) - penalty)
      taken++
      any = true
    }
    if (!any && constrained) {
      for (const [id, penalty] of exact) hit('pinyin', id, 450 - penalty)
      for (const [id, penalty] of prefix.slice(0, 300)) hit('pinyin', id, 300 - penalty)
    }
  }

  private searchHanViet(q: string, hit: Hit): void {
    const fq = foldKey(q)
    if (!fq || !/^[a-z ]+$/.test(fq)) return
    const typed = hasDiacritics(q)
    const qTone = typed ? toneKey(q) : ''
    const last = fq.slice(fq.lastIndexOf(' ') + 1)
    // Inside a syllable only once the query says enough: "an" is not a prefix of "anh".
    const inside = fq.includes(' ') || last.length >= 3
    const readings = (id: number) => {
      const f = this.row(id)
      return f[COL.hvAlt] ? [f[COL.hv], ...f[COL.hvAlt].split('|')] : [f[COL.hv]]
    }
    const prefix: [number, number][] = []
    const keys = this.hvK
    const lo = keys.first(fq)
    for (let i = lo; i < keys.keys.length && i - lo < SCAN_CAP && keys.keys[i].startsWith(fq); i++) {
      const key = keys.keys[i]
      const id = keys.ids[i]
      if (key.length === fq.length) {
        const rs = readings(id)
        const alt = foldKey(rs[0]) !== fq ? 10 : 0
        const tier = !typed ? 900 : rs.some((r) => toneKey(r) === qTone) ? 915 : 590
        hit('hanviet', id, tier - alt)
      } else if (key.charCodeAt(fq.length) === 32) prefix.push([id, 600])
      else if (inside) prefix.push([id, 560])
    }
    prefix.sort((a, b) => a[0] - b[0])
    for (const [id, tier] of prefix.slice(0, PREFIX_CAP)) {
      if (!typed) hit('hanviet', id, tier)
      else {
        const ok = readings(id).some((r) => tonePrefixOk(toneKey(r), qTone))
        hit('hanviet', id, ok ? tier + 15 : 450)
      }
    }
  }

  private searchMeaning(q: string, hit: Hit): void {
    this.searchMeaningOf(q, hit, 0)
    // "con lợn", "cái bút": the noun may be glossed without its classifier.
    const toks = foldKey(q).split(' ')
    if (toks.length > 1 && VI_CLASSIFIERS.has(toks[0])) this.searchMeaningOf(q.replace(/^\s*\S+\s+/, ''), hit, 15)
  }

  private searchMeaningOf(q: string, hit: Hit, penalty: number): void {
    const fq = foldKey(q)
    const toks = fq.split(' ').filter(Boolean)
    if (!toks.length) return
    const phrase = toks.length > 1
    const typed = hasDiacritics(q)
    const qTone = typed ? toneKey(q) : ''
    const langs = [
      { post: this.viP, gloss: this.viG, col: COL.vi, lang: 'vi' as const, bonus: 20, prefix: true },
      { post: this.enP, gloss: this.enG, col: COL.en, lang: 'en' as const, bonus: -300, prefix: false },
    ]
    for (const L of langs) {
      const last = toks[toks.length - 1]
      // The last word of a phrase may still be being typed: from 3 letters on, also the words it
      // begins ("hoc sin" → sinh). A single word only when it is no word itself ("nhi" is not "nhìn").
      const exactLast = L.post.get(last)
      const lastList = L.prefix && last.length >= 3 && (toks.length > 1 || !exactLast) ? L.post.prefixUnion(last) : exactLast
      if (!lastList) continue
      const others = toks.slice(0, -1).map((t) => L.post.get(t))
      if (others.some((l) => !l)) continue
      let cand: ArrayLike<number> = lastList
      for (const l of (others as Int32Array[]).sort((a, b) => a.length - b.length)) cand = intersectSorted(l, cand)
      const exactGloss = L.gloss.get(fq)
      const todo = new Set<number>()
      for (let i = 0; i < cand.length && i < MEANING_CAP; i++) todo.add(cand[i])
      if (exactGloss) for (let i = 0; i < exactGloss.length && i < 2000; i++) todo.add(exactGloss[i])
      for (const id of todo) {
        let best = 300
        let bestSense = 0
        let bestMarks = 0
        for (const g of this.glossesOf(id, L.col)) {
          if (best >= 910) break
          const core = g.core
          let t =
            core === fq
              ? 850
              : core.startsWith(fq + ' ')
                ? 700
                : ` ${core} `.includes(` ${fq} `)
                  ? 550
                  : ` ${core}`.includes(` ${fq}`)
                    ? 400
                    : 300
          // "người …" is a pattern, not the word; "uống (thuốc)" is one use of it.
          if (t === 850 && g.pattern) t = 550
          else if (t === 850 && g.narrowed) t = 700
          let marks = 0
          if (typed && t > 300 && L.lang === 'vi') {
            g.tone ??= toneKey(g.plain)
            marks = g.tone === qTone ? 40 : ` ${g.tone} `.includes(` ${qTone} `) ? 25 : -1
            // Typed diacritics that disagree (mèo ≠ mẹo, ngựa ≠ ngứa): another word.
            if (marks < 0) {
              t = 300
              marks = 0
            }
          }
          if (t > 300) t += g.sense === 0 ? 10 : -Math.min(45, 15 * g.sense)
          if (t >= 850 && phrase && L.lang === 'vi') t += 50
          if (t + marks > best + bestMarks) {
            best = t
            bestMarks = marks
            bestSense = g.sense
          }
        }
        hit('meaning', id, best + bestMarks + L.bonus - penalty, bestSense, L.lang)
      }
    }
  }
}

/**
 * Typed diacritics as a prefix of a reading: every whole typed syllable must match, and the last
 * (maybe half-typed) one must agree in the letters typed so far and, if a tone was typed, the tone.
 */
function tonePrefixOk(reading: string, typed: string): boolean {
  const r = reading.split(' ')
  const t = typed.split(' ')
  if (t.length > r.length) return false
  for (let i = 0; i < t.length - 1; i++) if (r[i] !== t[i]) return false
  const lastT = t[t.length - 1]
  const lastR = r[t.length - 1]
  const toneT = lastT.slice(-1)
  const lettersT = lastT.slice(0, -1)
  if (lastR.slice(0, -1) === lettersT) return toneT === '1' || lastR.slice(-1) === toneT
  return lastR.startsWith(lettersT) && toneT === '1'
}
