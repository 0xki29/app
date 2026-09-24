import { useEffect, useRef, useState } from 'react'
import { focusLostHeading, pageTitle } from '../app/screen'
import { backLinkClick, useEntryState } from '../app/history'
import { AddToDeck } from './AddToDeck'
import { dictionary, useDictStatus } from './client'
import './dict.css'
import { entryHref, lastSearchHref, PINYIN_HREF, practiceHref, rememberPage, reportIssueUrl, searchHref } from './links'
import { pinyinMarks } from './pinyin'
import type { WordChar, WordDetail } from './protocol'
import { firstMeaning, parseSense } from './senses'
import { useVoiceStatus } from './speech'
import { StrokePreview } from './StrokePreview'
import type { DictEntry } from './types'
import { DictStatusNotice, HskBadge, ListenButton, PinyinText, SenseView, SourceChip, sourceInfo } from './ui'

/** Senses shown before "Xem thêm". */
const FIRST_SENSES = 4

type Loaded = { key: string; full: boolean; word: WordDetail | null; error?: string }

/**
 * One dictionary entry: headword, pinyin (tap → the pinyin guide) with a listen button, Âm Hán Việt,
 * meanings with where they come from, "Thêm vào ôn tập", and the characters of the word — each with
 * its reading, a stroke-order preview and "Luyện viết".
 */
export function EntryScreen({ entryKey }: { entryKey: string }) {
  const status = useDictStatus()
  const full = status.state === 'ready'
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  // Asked again once the whole dictionary is in: a rare reading may only be in the rest.
  useEffect(() => {
    let alive = true
    dictionary.ensureLoaded()
    dictionary.word(entryKey).then(
      (word) => {
        if (alive) setLoaded({ key: entryKey, full, word })
      },
      (e: unknown) => {
        if (alive) setLoaded({ key: entryKey, full, word: null, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [entryKey, full])

  useEffect(() => {
    rememberPage(entryHref(entryKey))
  }, [entryKey])

  const current = loaded?.key === entryKey ? loaded : null
  const back = lastSearchHref()
  const found = current?.word?.entry ?? null

  // The page title names the word, and so does the browser's history list.
  useEffect(() => {
    if (found) document.title = pageTitle(`${found.simp} ${pinyinMarks(found.pinyin)} · Tra cứu`)
  }, [found])

  if (!current?.word) {
    // The worker answers null only once it has looked everywhere it could — or once the rarer
    // words failed to load (it answered from the core): that is not "not found".
    const failed = status.state === 'no-data' || status.state === 'error'
    const restFailed = !!status.error && !full
    return (
      <main className="dict dict-entry">
        <nav className="dict-top">
          <BackLink href={back} />
        </nav>
        <DictStatusNotice status={status} onRetry={() => dictionary.ensureLoaded()} />
        {!current ? (
          !failed && (
            <p className="dict-empty" aria-busy="true">
              Đang tìm mục từ…
            </p>
          )
        ) : failed ? null : current.error ? (
          <p className="dict-empty">{current.error}</p>
        ) : restFailed ? (
          <p className="dict-empty">Chưa mở được mục từ này: phần từ ít gặp của từ điển chưa tải được. Hãy bấm “Thử lại” ở trên.</p>
        ) : (
          <div className="dict-empty">
            <h1 className="dict-empty__title">Không tìm thấy mục từ này</h1>
            <p>
              Có thể dữ liệu từ điển đã được cập nhật.{' '}
              <a href={searchHref(entryKey.replace(/[|[].*$/, ''))}>Tra lại từ này</a>
            </p>
          </div>
        )}
      </main>
    )
  }

  const { entry, chars, sameForm, usualReading } = current.word
  return (
    <main className="dict dict-entry">
      <nav className="dict-top">
        <BackLink href={back} />
      </nav>
      <DictStatusNotice status={status} onRetry={() => dictionary.ensureLoaded()} />
      <Headword entry={entry} usualReading={usualReading} />
      <Meanings key={entry.key} entry={entry} dataVersion={status.dataVersion} />
      {sameForm.length > 0 && <OtherReadings entry={entry} others={sameForm} />}
      <section className="dict-sec" aria-labelledby="dict-add-h">
        <h2 id="dict-add-h" className="sr-only">
          Ôn tập
        </h2>
        <AddToDeck key={entry.key} entry={entry} chars={chars} />
      </section>
      {chars.length > 0 && <Characters entry={entry} chars={chars} />}
    </main>
  )
}

/** Back to the search: the browser's Back when the entry was opened from it (app/history.ts). */
function BackLink({ href }: { href: string }) {
  return (
    <a className="dict-top__back" href={href} onClick={backLinkClick(href)}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Tra cứu
    </a>
  )
}

function Headword({ entry, usualReading }: { entry: DictEntry; usualReading: boolean }) {
  const differs = entry.trad !== entry.simp
  const pn = entry.flags.includes('pn')
  const variant = entry.flags.includes('var')
  const voice = useVoiceStatus()
  // Opened from a link, focus fell to <body>: the headword takes it, so a screen reader says which entry opened.
  const h1 = useRef<HTMLHeadingElement>(null)
  useEffect(() => focusLostHeading(h1.current), [entry.key])
  return (
    <header className="dict-head">
      <h1 ref={h1} className="dict-head__word" tabIndex={-1}>
        <span lang="zh-Hans">{entry.simp}</span>
        {differs && (
          <span className="dict-head__trad">
            <span className="sr-only">, phồn thể </span>
            <span lang="zh-Hant">{entry.trad}</span>
          </span>
        )}
      </h1>
      {differs && <p className="dict-head__script">Giản thể · phồn thể</p>}
      <div className="dict-head__py">
        <a className="dict-pylink" href={PINYIN_HREF} aria-label={`Pinyin: ${pinyinMarks(entry.pinyin)}. Mở hướng dẫn đọc pinyin`}>
          <PinyinText numbered={entry.pinyin} />
        </a>
        <ListenButton text={entry.simp} label={`Nghe cách đọc ${entry.simp}`} />
        {!usualReading && voice === 'ready' && (
          <p className="dict-head__voice">
            Giọng đọc của máy đọc chữ đứng riêng theo âm thường gặp hơn, có thể không phải{' '}
            <em lang="zh-Latn-pinyin">{pinyinMarks(entry.pinyin)}</em>.
          </p>
        )}
      </div>
      <HanViet entry={entry} />
      {(entry.hsk || pn || variant) && (
        <p className="dict-head__tags">
          <HskBadge level={entry.hsk} />
          {pn && <span className="dict-badge">Tên riêng</span>}
          {variant && <span className="dict-badge">Dạng biến thể</span>}
        </p>
      )}
    </header>
  )
}

/**
 * The Âm Hán Việt line, with how far to trust it: a low-confidence syllable is dotted and says why
 * (Unihan kVietnamese may give a Nôm reading; otherwise the character's reading under another
 * pinyin was borrowed), and a reading set by AI curation says so until the owner reviews it.
 */
function HanViet({ entry }: { entry: DictEntry }) {
  const low = entry.flags.includes('hvlow')
  const nom = entry.flags.includes('hvnom')
  const byAi = entry.flags.includes('hvcur-ai')
  const alts = entry.hvAlt.filter((a) => a && a !== entry.hv)
  let value
  if (entry.hv === '-')
    value = <span className="dict-hv dict-hv--loan">không dùng — từ phiên âm, đọc theo Hán Việt không có nghĩa</span>
  else if (!entry.hv) value = <span className="dict-hv dict-hv--none">chưa có</span>
  else
    value = (
      <>
        <span className={low ? 'dict-hv dict-hv--low' : 'dict-hv'}>{entry.hv}</span>
        {low && <span className="dict-hv__note">{nom ? ' (có thể là âm Nôm)' : ' (chưa chắc chắn)'}</span>}
        {alts.length > 0 && <span className="dict-hv__alt"> · cũng đọc: {alts.join(', ')}</span>}
      </>
    )
  return (
    <p className="dict-head__hv">
      <span className="dict-label">Âm Hán Việt</span> {value}
      {byAi && <span className="dict-hv__note"> (AI đề xuất, chờ duyệt)</span>}
    </p>
  )
}

function Meanings({ entry, dataVersion }: { entry: DictEntry; dataVersion?: string }) {
  // Kept in the history entry: back on this page, the list is as long as it was left.
  const [open, setOpen] = useEntryState('senses-open', false)
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('li[tabindex]')?.focus()
  }, [open])
  const english = entry.vi.length === 0
  const all = english ? entry.en : entry.vi
  // Classifier lines ("Lượng từ: 个 (gè)") are not meanings: shown after the list, unnumbered.
  const senses = all.filter((s) => !parseSense(s).classifier)
  const classifiers = all.filter((s) => parseSense(s).classifier)
  const shown = open ? senses : senses.slice(0, FIRST_SENSES)
  const more = senses.length - shown.length
  const info = sourceInfo(entry.flags)
  return (
    <section className="dict-sec" aria-labelledby="dict-m-h">
      <div className="dict-sec__head">
        <h2 id="dict-m-h" className="dict-sec__title">
          Nghĩa
        </h2>
        {info && <SourceChip info={info} />}
      </div>
      {senses.length === 0 ? (
        <p className="dict-empty">Chưa có nghĩa cho mục này.</p>
      ) : (
        <ol ref={list} className="dict-senses" lang={english ? 'en' : undefined}>
          {shown.map((s, i) => (
            // The first sense "Xem thêm" reveals takes focus (the button goes away).
            <li key={i} tabIndex={i === FIRST_SENSES ? -1 : undefined}>
              <SenseView sense={s} />
            </li>
          ))}
        </ol>
      )}
      {more > 0 && (
        <button type="button" className="dict-link-btn" onClick={() => setOpen(true)}>
          Xem thêm {more} nghĩa
        </button>
      )}
      {classifiers.map((c, i) => (
        <p key={i} className="dict-classifier">
          <SenseView sense={c} />
        </p>
      ))}
      <p className="dict-source">
        {info?.explain}{' '}
        <a className="dict-source__report" href={reportIssueUrl(entry.key, dataVersion)} target="_blank" rel="noopener noreferrer">
          Báo lỗi
        </a>
      </p>
    </section>
  )
}

function OtherReadings({ entry, others }: { entry: DictEntry; others: DictEntry[] }) {
  return (
    <section className="dict-sec" aria-labelledby="dict-o-h">
      <h2 id="dict-o-h" className="dict-sec__title">
        {[...entry.simp].length === 1 ? 'Chữ này còn đọc là' : 'Cùng cách viết'}
      </h2>
      <ul className="dict-others">
        {others.map((o) => (
          <li key={o.key}>
            <a href={entryHref(o.key)} className="dict-others__link">
              <PinyinText numbered={o.pinyin} />
              {o.hv && o.hv !== '-' && <span className="dict-others__hv">{o.hv}</span>}
              <span className="dict-others__meaning">{firstMeaning(o.vi.length ? o.vi : o.en)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Characters({ entry, chars }: { entry: DictEntry; chars: readonly WordChar[] }) {
  const single = [...entry.simp].length === 1
  return (
    <section className="dict-sec" aria-labelledby="dict-c-h">
      <h2 id="dict-c-h" className="dict-sec__title">
        {single ? 'Viết chữ này' : 'Chữ trong từ'}
      </h2>
      <ul className="dict-chars">
        {chars.map((c) => (
          <CharCard key={c.char} c={c} self={c.entry?.key === entry.key} />
        ))}
      </ul>
      <p className="dict-foot">Thứ tự nét theo chuẩn Trung Quốc đại lục (cả với chữ phồn thể).</p>
    </section>
  )
}

function CharCard({ c, self }: { c: WordChar; self: boolean }) {
  const own = c.entry
  // The character's own reading (生 shēng), even where the word has it in the neutral tone.
  const reading = own?.pinyin || c.reading
  const meaning = own ? firstMeaning(own.vi.length ? own.vi : own.en) : ''
  const head = (
    <>
      <span className="dict-char__han" lang="zh-Hans">
        {c.char}
      </span>
      <span className="dict-char__read">
        {reading && <PinyinText numbered={reading} />}
        {c.hv && <span className="dict-char__hv">{c.hv}</span>}
      </span>
    </>
  )
  return (
    <li className="dict-char">
      {c.hasStrokes && <StrokePreview char={c.char} />}
      <div className="dict-char__body">
        {own && !self ? (
          <a className="dict-char__head" href={entryHref(own.key)}>
            {head}
          </a>
        ) : (
          <div className="dict-char__head">{head}</div>
        )}
        {meaning && !self && <p className="dict-char__meaning">{meaning}</p>}
        {c.hasStrokes ? (
          <a className="btn dict-char__practice" href={practiceHref(c.char)}>
            Luyện viết
          </a>
        ) : (
          <p className="dict-char__nostroke">Chưa có dữ liệu nét viết cho chữ này.</p>
        )}
        {c.trad && (
          <p className="dict-char__trad">
            Phồn thể <span lang="zh-Hant">{c.trad}</span>
          </p>
        )}
        {c.trad && c.tradHasStrokes && (
          // Button-sized: it is an entry's only way to practising the traditional form.
          <a className="btn dict-char__practice dict-char__practice--trad" href={practiceHref(c.trad)}>
            Luyện viết chữ phồn thể
          </a>
        )}
      </div>
    </li>
  )
}
