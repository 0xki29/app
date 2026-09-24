import { useSyncExternalStore } from 'react'

/**
 * Listening to Mandarin with the Web Speech API. Needs a Mandarin voice on the device (many
 * Vietnamese Windows PCs have none; Chrome's and Edge's online voices need a connection).
 *
 * Voices arrive asynchronously in some browsers (`voiceschanged`), so availability is a small store:
 * 'loading' until the list is known (or 2 s pass), then 'ready' or 'none'.
 */

export type VoiceStatus = 'unsupported' | 'loading' | 'none' | 'ready'

const WAIT_MS = 2000

/**
 * The Mandarin voice to use: mainland (zh-CN, cmn) before Taiwan; never Cantonese (zh-HK, yue);
 * a voice on the device (works offline) before an online one.
 */
export function pickVoice(voices: readonly Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>[]) {
  const mandarin = voices.filter((v) => {
    const lang = v.lang.replace('_', '-').toLowerCase()
    if (!/^(zh|cmn)(-|$)/.test(lang)) return false
    return !/(-hk|-mo|yue)/.test(lang) && !/cantonese|粤|粵/i.test(v.name)
  })
  const rank = (v: (typeof mandarin)[number]) => {
    const lang = v.lang.replace('_', '-').toLowerCase()
    const mainland = /^(zh-cn|zh-hans|cmn)/.test(lang) || lang === 'zh' ? 0 : 2
    return mainland + (v.localService ? 0 : 1)
  }
  return [...mandarin].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

let status: VoiceStatus = 'loading'
let voice: SpeechSynthesisVoice | null = null
let started = false
const listeners = new Set<() => void>()

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

function refresh(final: boolean): void {
  const s = synth()
  if (!s) {
    status = 'unsupported'
  } else {
    voice = pickVoice(s.getVoices()) as SpeechSynthesisVoice | null
    status = voice ? 'ready' : final || s.getVoices().length > 0 ? 'none' : 'loading'
  }
  for (const l of [...listeners]) l()
}

function startWatching(): void {
  if (started) return
  started = true
  const s = synth()
  if (!s) {
    refresh(true)
    return
  }
  s.addEventListener('voiceschanged', () => refresh(false))
  refresh(false)
  setTimeout(() => refresh(true), WAIT_MS)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  startWatching()
  return () => listeners.delete(cb)
}

export function useVoiceStatus(): VoiceStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => 'loading',
  )
}

/** Says `text` (hanzi) in Mandarin; false if there is no voice. Stops anything still being said. */
export function speak(text: string): boolean {
  const s = synth()
  if (!s || !voice) return false
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voice
  u.lang = voice.lang
  u.rate = 0.85
  s.speak(u)
  return true
}
