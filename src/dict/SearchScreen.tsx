import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useEntryState } from '../app/history'
import { useRoute } from '../app/router'
import { dictionary, isSearchable, useDictStatus } from './client'
import './dict.css'
import { CREDITS_HREF, entryHref, PINYIN_HREF, rememberSearch, searchHref } from './links'
import { firstMeaning, plainSense } from './senses'
import type { MatchKind, SearchGroup, SearchHit, SearchResult } from './types'
import { DictStatusNotice, HskBadge, PinyinText } from './ui'

const DEBOUNCE_MS = 100
/** Hits per group before "Xem thêm", and in the plain list. */
const GROUP_FIRST = 5
const LIST_FIRST = 30

const GROUP_TITLE: Record<MatchKind, string> = {
  hanzi: 'Chữ Hán',
  pinyin: 'Theo pinyin',
  hanviet: 'Theo âm Hán Việt',
  meaning: 'Theo nghĩa',
}

const EXAMPLES = ['学生', 'xuéshēng', 'hoc sinh', 'cảm ơn', 'an', '學習']

type Answer = { q: string; full: boolean; result: SearchResult | null; error?: string }

/**
 * Tra cứu: one box for hanzi (simplified or traditional), pinyin (with or without tones), Hán Việt
 * and Vietnamese meanings. Results come from the dictionary worker as the learner types (debounced);
 * a one-word Latin query that matches in several ways is shown in groups. The query lives in the
 * address (#/tra-cuu?q=…), so going back from an entry returns to the same results.
 */
export function DictionarySearchScreen() {
  const route = useRoute()
  const [q, setQ] = useState(() => route.query.q ?? '')
  const [debounced, setDebounced] = useState(() => (route.query.q ?? '').trim())
  const [answer, setAnswer] = useState<Answer | null>(null)
  const status = useDictStatus()
  const searchable = isSearchable(status)
  const full = status.state === 'ready'
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dictionary.ensureLoaded()
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  // The query in the address, without a history entry per keystroke.
  useEffect(() => {
    const href = searchHref(debounced)
    rememberSearch(href)
    if (window.location.hash !== href) window.history.replaceState(window.history.state, '', href)
  }, [debounced])

  // Searched again when the rest of the dictionary arrives.
  useEffect(() => {
    if (!debounced || !searchable) return
    let alive = true
    dictionary.search(debounced, 60).then(
      (result) => {
        if (alive && !result.stale) setAnswer({ q: debounced, full, result })
      },
      (e: unknown) => {
        if (alive) setAnswer({ q: debounced, full, result: null, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [debounced, searchable, full])

  const shown = debounced && answer?.result ? answer : null
  const settled = shown?.q === debounced
  const top = settled ? shown.result?.hits[0] : undefined

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    // Enter opens the best match, once the results are those of what is typed.
    if (top && q.trim() === debounced) window.location.hash = entryHref(top.entry.key)
  }

  const count = settled && shown.result ? shown.result.hits.length : null
  const announce = !debounced || count === null ? '' : count === 0 ? 'Không có kết quả' : `${count >= 60 ? 'Hơn 60' : count} kết quả`

  return (
    <main className="dict dict-search">
      <header className="dict-top">
        <h1 className="dict-top__title" tabIndex={-1}>
          Tra cứu
        </h1>
      </header>
      <form role="search" className="dict-box" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="dict-q">
          Tìm chữ Hán, pinyin, âm Hán Việt hoặc nghĩa tiếng Việt
        </label>
        <input
          ref={input}
          id="dict-q"
          className="dict-box__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          // A fresh search opens the keyboard; coming back to results does not.
          autoFocus={!q}
          placeholder="学生 · xuesheng · hoc sinh · cảm ơn"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            className="dict-box__clear"
            aria-label="Xoá nội dung tìm"
            onClick={() => {
              setQ('')
              input.current?.focus()
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </form>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <DictStatusNotice status={status} onRetry={() => dictionary.ensureLoaded()} />
      {!debounced ? (
        <Welcome onPick={setQ} />
      ) : shown?.result ? (
        <Results result={shown.result} stale={!settled} partial={!shown.full} restFailed={!full && !!status.error} />
      ) : answer?.error && answer.q === debounced && status.state !== 'no-data' && status.state !== 'error' ? (
        <p className="dict-empty">{answer.error}</p>
      ) : null}
    </main>
  )
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="dict-welcome">
      <p>
        Gõ <strong>chữ Hán</strong> (giản thể hoặc phồn thể), <strong>pinyin</strong> (có dấu như <em>xué</em>, số thanh như{' '}
        <em>xue2</em>, hoặc không dấu), <strong>âm Hán Việt</strong> hoặc <strong>nghĩa tiếng Việt</strong> — có dấu hay không
        dấu đều được.
      </p>
      <p className="dict-welcome__label">Thử:</p>
      <ul className="dict-welcome__examples">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button type="button" className="dict-example" onClick={() => onPick(ex)}>
              {ex}
            </button>
          </li>
        ))}
      </ul>
      <p className="dict-welcome__links">
        <a href={PINYIN_HREF}>Pinyin cho người Việt</a>
        <span aria-hidden="true"> · </span>
        <a href={CREDITS_HREF}>Giới thiệu &amp; nguồn dữ liệu</a>
      </p>
    </div>
  )
}

function Results({ result, stale, partial, restFailed }: { result: SearchResult; stale: boolean; partial: boolean; restFailed: boolean }) {
  if (result.hits.length === 0)
    return (
      <div className="dict-empty">
        <p className="dict-empty__title">Không tìm thấy “{result.query}”.</p>
        <p>Thử gõ không dấu, gõ pinyin kèm số thanh (xue2), hoặc chỉ gõ một phần của từ.</p>
        {partial &&
          (restFailed ? (
            <p>Phần từ ít gặp của từ điển chưa tải được, nên chưa tìm trong đó. Hãy bấm “Thử lại” ở trên.</p>
          ) : (
            <p>Từ điển còn đang tải phần từ ít gặp; kết quả có thể xuất hiện khi tải xong.</p>
          ))}
      </div>
    )
  // English is searched only in entries that have no Vietnamese yet: say so when that is most of
  // what came back ("water" finds "water roux", not 水).
  const english = result.hits.filter((h) => h.lang === 'en').length
  return (
    <div className={stale ? 'dict-results dict-results--stale' : 'dict-results'} aria-busy={stale || undefined}>
      {english > 0 && english * 2 >= result.hits.length && (
        <p className="dict-notice dict-notice--quiet">
          Tìm theo tiếng Anh chỉ gồm các mục chưa có nghĩa tiếng Việt, nên thường không ra từ thông dụng. Hãy gõ nghĩa
          tiếng Việt (như “nước” thay cho “water”).
        </p>
      )}
      {result.groups ? (
        result.groups.map((g) => <Group key={`${result.query}:${g.kind}`} group={g} query={result.query} />)
      ) : (
        <HitList key={result.query} hits={result.hits} first={LIST_FIRST} label="Kết quả" query={result.query} />
      )}
    </div>
  )
}

function Group({ group, query }: { group: SearchGroup; query: string }) {
  const id = `dict-g-${group.kind}`
  return (
    <section className="dict-group" aria-labelledby={id}>
      <h2 id={id} className="dict-group__title">
        {GROUP_TITLE[group.kind]}
        <span className="dict-group__count"> · {group.total}</span>
      </h2>
      <HitList hits={group.hits} first={GROUP_FIRST} label={GROUP_TITLE[group.kind]} query={query} />
      {/* A group keeps its best matches only: say how to reach the others. */}
      {group.total > group.hits.length && (
        <p className="dict-group__more">
          Hiện {group.hits.length} trong {group.total} kết quả. Gõ thêm dấu thanh hoặc số thanh (như <em>an4</em>), hoặc gõ
          cả từ, để thu hẹp.
        </p>
      )}
    </section>
  )
}

function HitList({ hits, first, label, query }: { hits: SearchHit[]; first: number; label: string; query: string }) {
  // Kept in the history entry, for this query: back from an entry, the list is as long as it was left.
  const [openFor, setOpenFor] = useEntryState<string | null>(`more:${label}`, null)
  const open = openFor === query
  const list = useRef<HTMLUListElement>(null)
  const shown = open ? hits : hits.slice(0, first)
  const opened = useRef(false)
  // "Xem thêm" goes away once pressed: focus moves to the first result it revealed (not when the
  // list comes back open with Back).
  useEffect(() => {
    if (open && opened.current) list.current?.querySelectorAll('a')[first]?.focus()
    opened.current = false
  }, [open, first])
  return (
    <>
      <ul ref={list} className="dict-hits" aria-label={label}>
        {shown.map((h) => (
          <HitRow key={h.entry.key} hit={h} />
        ))}
      </ul>
      {hits.length > shown.length && (
        <button
          type="button"
          className="dict-link-btn dict-more"
          onClick={() => {
            opened.current = true
            setOpenFor(query)
          }}
        >
          Xem thêm {hits.length - shown.length} kết quả
        </button>
      )}
    </>
  )
}

function HitRow({ hit }: { hit: SearchHit }) {
  const e = hit.entry
  const english = e.vi.length === 0
  const senses = english ? e.en : e.vi
  // A meaning match shows the sense that matched; anything else the first meaning.
  const meaning = hit.kind === 'meaning' && hit.sense > 0 && senses[hit.sense] ? plainSense(senses[hit.sense]) : firstMeaning(senses)
  return (
    <li>
      <a className="dict-hit" href={entryHref(e.key)}>
        <span className="dict-hit__top">
          <span className="dict-hit__simp" lang="zh-Hans">
            {e.simp}
          </span>
          {e.trad !== e.simp && (
            <span className="dict-hit__trad" lang="zh-Hant">
              <span className="sr-only">phồn thể </span>
              {e.trad}
            </span>
          )}
          <PinyinText numbered={e.pinyin} className="dict-hit__py" />
          {e.hv && e.hv !== '-' && (
            <span className="dict-hit__hv">
              <span className="sr-only">Hán Việt </span>
              {e.hv}
            </span>
          )}
          <HskBadge level={e.hsk} />
        </span>
        {meaning && (
          <span className="dict-hit__meaning">
            <span lang={english ? 'en' : undefined}>{meaning}</span>
            {english && <span className="dict-hit__tag"> (tiếng Anh)</span>}
          </span>
        )}
      </a>
    </li>
  )
}
