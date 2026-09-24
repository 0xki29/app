import { dayStart, isDue } from './scheduler'
import type { CardState, FsrsCardState } from './types'

/** Learner-facing wording for due times and card states (pure; tested with a fixed clock). */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * When `due` comes, from `now`, in learning days (they start at `hour`): "bây giờ", "sau 5 phút",
 * "sau 3 giờ", "ngày mai", "sau 4 ngày", or a date past a month.
 */
export function dueText(due: number, now: number, hour: number): string {
  if (due <= now) return 'bây giờ'
  const today = dayStart(now, hour)
  const days = Math.round((dayStart(due, hour) - today) / (24 * HOUR))
  if (days <= 0) {
    const ms = due - now
    if (ms < HOUR) return `sau ${Math.max(1, Math.round(ms / MINUTE))} phút`
    return `sau ${Math.round(ms / HOUR)} giờ`
  }
  if (days === 1) return 'ngày mai'
  if (days < 31) return `sau ${days} ngày`
  const d = new Date(due)
  return `ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

/**
 * When a card is due, as Hôm nay counts it: a card in the review state is due for the whole
 * learning day it falls in ("bây giờ" from the day's start, never "sau 3 giờ" for a card Hôm nay
 * already offers), and after that by the day; a learning step is due at its minute.
 */
export function cardDueText(s: Pick<FsrsCardState, 'state' | 'due'>, now: number, hour: number): string {
  // Not due today: a later learning day, which dueText counts in days.
  if (s.state === 'review' && isDue(s, now, hour)) return 'bây giờ'
  return dueText(s.due, now, hour)
}

export const STATE_LABEL: Record<CardState, string> = {
  new: 'Chưa học',
  learning: 'Đang học',
  review: 'Đang ôn',
  relearning: 'Học lại',
}
