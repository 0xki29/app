import { useId, type ReactNode } from 'react'
import { backLinkClick } from '../app/history'
import { isSearchable, WORKER_FAILED } from './client'
import { entryHref } from './links'
import { pinyinSyllables } from './pinyin'
import { parseSense, type SensePart } from './senses'
import { speak, useVoiceStatus } from './speech'
import type { DictStatus } from './types'

/** Small pieces shared by the dictionary screens. */

/** Pinyin with tone marks, each syllable in its tone's color (the mark itself says the tone too). */
export function PinyinText({ numbered, className }: { numbered: string; className?: string }) {
  const syllables = pinyinSyllables(numbered)
  return (
    <span className={['dict-py', className].filter(Boolean).join(' ')} lang="zh-Latn-pinyin">
      {syllables.map((s, i) => (
        <span key={i}>
          {i > 0 && !s.joined ? ' ' : ''}
          <span className={`dict-t${s.tone}`}>{s.text}</span>
        </span>
      ))}
    </span>
  )
}

const HSK_LABEL: Record<number, string> = { 7: 'HSK 7–9' }

export function hskLabel(level: number): string {
  return HSK_LABEL[level] ?? `HSK ${level}`
}

export function HskBadge({ level }: { level: number | null }) {
  if (!level) return null
  return <span className="dict-badge dict-badge--hsk">{hskLabel(level)}</span>
}

export interface SourceInfo {
  label: string
  tone: 'ok' | 'ai' | 'mt' | 'none'
  explain: string
}

/** Where an entry's meanings come from, as the chip and its one-line explanation say it. */
export function sourceInfo(flags: readonly string[]): SourceInfo | null {
  const added = flags.includes('added')
  if (flags.includes('cur'))
    return { label: 'đã hiệu đính', tone: 'ok', explain: added ? 'Mục từ này do dự án soạn (CC-CEDICT chưa có), đã được người kiểm tra.' : 'Nghĩa tiếng Việt đã được người kiểm tra.' }
  if (flags.includes('cur-ai'))
    return {
      label: 'hiệu đính bởi AI, chờ duyệt',
      tone: 'ai',
      explain: added
        ? 'Mục từ này do AI soạn (CC-CEDICT chưa có), chưa có người duyệt.'
        : 'Nghĩa tiếng Việt do AI viết lại cho dễ hiểu, chưa có người duyệt.',
    }
  if (flags.includes('mt'))
    return {
      label: 'bản dịch máy',
      tone: 'mt',
      explain: 'Nghĩa tiếng Việt được máy dịch từ từ điển Trung–Anh CC-CEDICT (dự án CVDICT), có thể chưa chính xác.',
    }
  if (flags.includes('en'))
    return { label: 'chưa có bản dịch', tone: 'none', explain: 'Mục này chưa có nghĩa tiếng Việt; đang hiện nghĩa tiếng Anh gốc.' }
  return null
}

export function SourceChip({ info }: { info: SourceInfo }) {
  return <span className={`dict-chip dict-chip--${info.tone}`}>{info.label}</span>
}

/** One sense: notes in parentheses subdued, hanzi in the CJK font, cross-references as links. */
export function SenseView({ sense }: { sense: string }) {
  const parsed = parseSense(sense)
  return (
    <>
      {parsed.classifier && <span className="dict-sense__label">Lượng từ: </span>}
      {parsed.spans.map((span, i) => {
        const content = span.parts.map(renderPart)
        return span.note ? (
          <span key={i} className="dict-note">
            {content}
          </span>
        ) : (
          <span key={i}>{content}</span>
        )
      })}
    </>
  )
}

function renderPart(p: SensePart, j: number) {
  switch (p.kind) {
    case 'text':
      return <span key={j}>{p.text}</span>
    case 'pinyin':
      return (
        <span key={j} className="dict-sense__py">
          {p.text}
        </span>
      )
    case 'zh':
      return (
        <span key={j} lang="zh-Hans" className="dict-zh">
          {p.text}
        </span>
      )
    case 'ref':
      // The traditional form too when it differs: "biến thể của 臺|台" on the page of 台 would
      // otherwise read "biến thể của 台", a reference to itself.
      return (
        <a key={j} className="dict-ref" href={entryHref(p.key)}>
          <span lang="zh-Hans" className="dict-zh">
            {p.hanzi}
          </span>
          {p.trad !== p.hanzi && (
            <span className="dict-ref__trad">
              {' ('}
              <span lang="zh-Hant" className="dict-zh">
                {p.trad}
              </span>
              {')'}
            </span>
          )}{' '}
          <span className="dict-ref__py">{p.pinyin}</span>
        </a>
      )
  }
}

/** A speaker button that says `text` in Mandarin, or explains why it cannot. */
export function ListenButton({ text, label, showHint = true }: { text: string; label: string; showHint?: boolean }) {
  const voice = useVoiceStatus()
  const hintId = useId()
  const off = voice !== 'ready'
  const hint =
    voice === 'unsupported'
      ? 'Trình duyệt này không đọc được tiếng Trung.'
      : voice === 'none'
        ? 'Máy chưa có giọng đọc tiếng Trung. Cài thêm giọng "Tiếng Trung (Trung Quốc)" trong cài đặt ngôn ngữ của máy để nghe.'
        : null
  return (
    <span className="dict-listen">
      <button
        type="button"
        className="dict-listen__btn"
        aria-label={label}
        aria-disabled={off || undefined}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => {
          if (!off) speak(text)
        }}
      >
        <SpeakerIcon />
      </button>
      {hint && showHint && (
        <span id={hintId} className="dict-listen__hint">
          {hint}
        </span>
      )}
      {hint && !showHint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </span>
  )
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path
        d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

const MB = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatMB(bytes: number): string {
  return `${MB.format(bytes / 1_000_000)} MB`
}

/** On a dev server, how to get the data a missing manifest means (never shown on the site). */
const DEV_NO_DATA = 'Máy chủ phát triển: chạy npm run data:build rồi tải lại trang.'

/**
 * The dictionary's loading state as a notice: progress while the core downloads, a quiet line while
 * the rest does, the error with a retry (a reload when the app itself failed to start).
 */
export function DictStatusNotice({ status, onRetry }: { status: DictStatus; onRetry: () => void }) {
  if (status.state === 'no-data' || status.state === 'error') {
    const reload = status.error === WORKER_FAILED
    return (
      <div className="dict-notice dict-notice--error" role="alert">
        <p>{status.error ?? 'Không tải được từ điển.'}</p>
        {status.state === 'no-data' && import.meta.env.DEV && <p className="dict-notice__dev">{DEV_NO_DATA}</p>}
        <button type="button" className="btn dict-notice__retry" onClick={reload ? () => window.location.reload() : onRetry}>
          {reload ? 'Tải lại trang' : 'Thử lại'}
        </button>
      </div>
    )
  }
  if (status.state === 'idle' || status.state === 'loading-core') {
    const pct = Math.round(status.progress * 100)
    const bytes =
      status.totalBytes && status.loadedBytes !== undefined
        ? ` ${formatMB(status.loadedBytes)} / ${formatMB(status.totalBytes)}`
        : ''
    return (
      <div className="dict-notice">
        <p className="dict-notice__line">
          {status.building ? 'Đang chuẩn bị từ điển…' : `Đang tải từ điển…${bytes}`}
        </p>
        <progress className="dict-progress" max={100} value={status.building ? undefined : pct} aria-label="Tải từ điển">
          {pct}%
        </progress>
      </div>
    )
  }
  if (isSearchable(status) && status.state !== 'ready') {
    if (status.error)
      return (
        <div className="dict-notice dict-notice--quiet">
          <p>{status.error}</p>
          <button type="button" className="dict-link-btn" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )
    return (
      <p className="dict-notice dict-notice--quiet">
        Đã tra được các từ thông dụng; đang tải thêm từ ít gặp
        {status.building ? '…' : ` (${Math.round(status.progress * 100)}%)…`}
      </p>
    )
  }
  return null
}

/** The screen's top bar: a back link and the title. */
export function TopBar({ back, backLabel, title, extra }: { back?: string; backLabel?: string; title: ReactNode; extra?: ReactNode }) {
  return (
    <header className="dict-top">
      {back && (
        <a className="dict-top__back" href={back} aria-label={backLabel ?? 'Quay lại'} onClick={backLinkClick(back)}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
      <h1 className="dict-top__title" tabIndex={-1}>
        {title}
      </h1>
      {extra}
    </header>
  )
}
