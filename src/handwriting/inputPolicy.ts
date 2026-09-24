import type { PointerKind, StrokeEnd } from './types'

/**
 * Which pointer contacts become strokes. Pure functions of what the input controller has seen, so
 * every rule is unit-tested without a DOM. Times are PointerEvent.timeStamp ms (one clock with
 * performance.now()); distances are in box units (1 = the side of the character box).
 *
 * "Reach" is how far a stroke has got from its first sample (the farthest sample so far). It is
 * used instead of path length because a finger held still still jitters, and jitter adds up in a
 * path length but not in reach.
 */

/**
 * A tap: reach below TAP_MAX_REACH *and* shorter than TAP_MAX_MS. It is not a stroke: a Chinese dot
 * (点) is a short stroke, not a zero-length touch. The shortest strokes in the bundled data (the
 * dots of 謝) reach 0.06 box along their median, ten times this limit; 0.006 box is 1.8 px in a
 * 300 px box — sensor jitter, not a written mark. Both conditions must hold, so a quick dot that
 * moves is kept, and so is a deliberate press held in place — with a last sample at the time of the
 * lift, so that a stroke's own samples say how long it lasted (see stillPressEnd).
 */
export const TAP_MAX_REACH = 0.006
export const TAP_MAX_MS = 150

/**
 * Touch is ignored while a pen is down and for this long after the last pen event (down, move —
 * including hover — or up): the hand holding the pen rests on the screen between strokes. After
 * that, touch works again (a learner may put the pen down and use a finger).
 */
export const PEN_GRACE_MS = 1500

/**
 * A touch that has not yet reached TAKEOVER_MAX_REACH from where it landed may be a resting palm,
 * hand edge or thumb. While it has not, a second touch is watched too (standby), and whichever of
 * the two first reaches TAKEOVER_MAX_REACH writes; the other is dropped as a palm. A still touch
 * that ends while another touch was down is dropped too. So neither the order in which a palm and a
 * finger land, nor how long the palm has rested, decides which one writes. A young still touch
 * (under TAKEOVER_MAX_MS) whose contact grows to palm size is dropped (palms spread as they land).
 */
export const TAKEOVER_MAX_REACH = 0.02
export const TAKEOVER_MAX_MS = 250

/**
 * A touch whose contact (PointerEvent.width/height, CSS px) exceeds this on either axis is a palm or
 * hand edge. Set well above a fingertip on every platform: WebKit reports width = 2 × UIKit's touch
 * radius, which for a light fingertip is ≈ 21 pt (≈ 42 px) and grows in ≈ 10 px steps with
 * pressure, so a limit near 40 px would reject every finger on iOS. Rejecting a finger makes the
 * box unusable; a missed palm leaves a stray stroke that Undo removes. Devices that report no
 * geometry send 1 (or 0) and are never rejected.
 */
export const PALM_CONTACT_PX = 80

/** Why a contact was not kept as a stroke. */
export type DiscardReason = 'tap' | 'palm'

/** What the controller tracks about the stroke in progress. */
export interface StrokeProgress {
  kind: PointerKind
  /** timeStamp of its pointerdown. */
  startTs: number
  /** Farthest distance from its first sample so far, in box units. */
  reach: number
}

/** A pointerdown, reduced to what the policy needs. */
export interface DownInput {
  kind: PointerKind
  /** PointerEvent.button: only the primary button (0) writes. */
  button: number
  /** Contact size in CSS px; undefined/NaN when not reported. */
  width?: number
  height?: number
  timeStamp: number
}

export type IgnoreReason =
  /** Not the primary button (right click, pen barrel or eraser button). */
  | 'button'
  /** A touch while a pen is down or was just used. */
  | 'pen'
  /** A touch with a palm-sized contact. */
  | 'palm'
  /** Another stroke is in progress and keeps priority. */
  | 'busy'

export type DownDecision =
  | { action: 'start' }
  /** Drop the stroke in progress as a palm, then start this one. */
  | { action: 'replace' }
  /** End the stroke in progress as 'lost' (its pointerup never came), then start this one. */
  | { action: 'restart' }
  /** Watch this touch next to the still one in progress: whichever moves first writes (see TAKEOVER_MAX_REACH). */
  | { action: 'standby' }
  | { action: 'ignore'; reason: IgnoreReason }

const START: DownDecision = { action: 'start' }
const REPLACE: DownDecision = { action: 'replace' }
const RESTART: DownDecision = { action: 'restart' }
const STANDBY: DownDecision = { action: 'standby' }
const ignore = (reason: IgnoreReason): DownDecision => ({ action: 'ignore', reason })

/** A contact that never became writing: quick and still. */
export function isTap(reach: number, durationMs: number): boolean {
  return reach < TAP_MAX_REACH && durationMs < TAP_MAX_MS
}

/**
 * Whether a contact that ended is dropped instead of kept as a stroke: a tap, however it ended; a
 * still contact the app ended ('interrupted': "Chấm điểm" pressed, tab hidden), whatever its length
 * — a thumb resting on the box is not a stroke; and a still touch that had company (`crowded`:
 * another touch was down during it), which was the palm, not the writing.
 */
export function dropsAtEnd(reach: number, durationMs: number, end: StrokeEnd, crowded: boolean): DiscardReason | null {
  if (isTap(reach, durationMs) || (end === 'interrupted' && reach < TAP_MAX_REACH)) return 'tap'
  if (crowded && reach < TAKEOVER_MAX_REACH) return 'palm'
  return null
}

/**
 * A kept contact whose samples do not show how long it lasted: it never moved after the first
 * sample, so they span less than TAP_MAX_MS while the contact did not (a deliberate press). Its
 * last sample is then repeated at the lift, so anything reading the ink (the stroke check) sees the
 * same duration the input judged. Null when the samples already show it.
 */
export function stillPressEnd(reach: number, lastSampleT: number, durationMs: number): number | null {
  return isTap(reach, lastSampleT) && !isTap(reach, durationMs) ? durationMs : null
}

export function isPalmContact(width: number | undefined, height: number | undefined): boolean {
  return exceeds(width) || exceeds(height)
}

function exceeds(size: number | undefined): boolean {
  return typeof size === 'number' && Number.isFinite(size) && size > PALM_CONTACT_PX
}

/**
 * Pen priority over touch. `lastPenTs` is the timeStamp of the last pen event (−Infinity if none);
 * an earlier `now` (events delivered out of order) counts as recent.
 */
export function penHasPriority(penDown: boolean, lastPenTs: number, now: number): boolean {
  return penDown || now - lastPenTs < PEN_GRACE_MS
}

/** The stroke has barely moved and only just started: its contact may still spread into a palm. */
export function isUnsettled(stroke: StrokeProgress, now: number): boolean {
  return stroke.reach < TAKEOVER_MAX_REACH && now - stroke.startTs < TAKEOVER_MAX_MS
}

/** A touch that has not moved from where it landed (yet): it may be a resting palm or thumb. */
export function isStill(reach: number): boolean {
  return reach < TAKEOVER_MAX_REACH
}

/**
 * Mouse or pen moving without its primary button (the left button, the pen tip) while a stroke is
 * active: its pointerup was lost (released outside the window, a dialog, a driver hiccup, or
 * released while another button is still held), so the stroke is over. Touch always reports a
 * button while in contact. Only for a device whose pointerdown reported the primary button
 * (`downButtons`): one that reports none at all would otherwise lose every stroke at its first move.
 */
export function releasedWithoutUp(kind: PointerKind, buttons: number, downButtons: number): boolean {
  return kind !== 'touch' && (downButtons & 1) !== 0 && (buttons & 1) === 0
}

/**
 * Whether a pointerdown starts a stroke, replaces the one in progress (which is then dropped as a
 * palm), ends it first (a lost pointerup), is watched next to it, or is ignored. `active` is the
 * stroke in progress, if any.
 */
export function decideDown(down: DownInput, active: StrokeProgress | null, lastPenTs: number): DownDecision {
  if (down.button !== 0) return ignore('button')
  if (down.kind === 'touch') {
    if (penHasPriority(active?.kind === 'pen', lastPenTs, down.timeStamp)) return ignore('pen')
    if (isPalmContact(down.width, down.height)) return ignore('palm')
  }
  if (!active) return START
  // A pen landing during a touch stroke: that touch was most likely the hand holding the pen.
  if (down.kind === 'pen' && active.kind === 'touch') return REPLACE
  // The same mouse, or a pen, down again: the stroke in progress never saw its pointerup.
  if (down.kind !== 'touch' && down.kind === active.kind) return RESTART
  // A palm, hand edge or thumb may rest on the box before or while the finger writes.
  if (down.kind === 'touch' && active.kind === 'touch' && isStill(active.reach)) return STANDBY
  return ignore('busy')
}
