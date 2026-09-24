import { useSyncExternalStore } from 'react'
import { goBackTo } from './history'

/**
 * A tiny hash router: `#/path?query`. Hash routing because the site is static (GitHub Pages at any
 * sub-path): every screen is the same index.html, and a reload never asks the server for a path it
 * does not have.
 *
 * Screens are listed in ROUTES; adding one is one line here and one case in App.tsx. Anything that
 * is not `#/…` (no hash, or an in-page anchor like `#main`) is the home screen.
 */

export interface RouteDef<Id extends string = string> {
  id: Id
  /** `/`-separated segments; `:name` captures one segment. */
  pattern: string
}

export const ROUTES = [
  { id: 'today', pattern: '/' },
  { id: 'search', pattern: '/tra-cuu' },
  { id: 'entry', pattern: '/tu/:key' },
  { id: 'pinyin', pattern: '/pinyin' },
  { id: 'credits', pattern: '/nguon-du-lieu' },
  { id: 'deck', pattern: '/so-on-tap' },
  { id: 'session', pattern: '/on-tap' },
  { id: 'practice', pattern: '/luyen/:hex' },
] as const satisfies readonly RouteDef[]

export type RouteId = (typeof ROUTES)[number]['id'] | 'not-found'

export interface Route {
  id: RouteId
  /** The path matched, e.g. `/`. */
  path: string
  /** `:name` segments, decoded. */
  params: Record<string, string>
  /** The query after `?`, decoded. */
  query: Record<string, string>
}

const HOME: RouteId = 'today'

/** The route a location hash (`location.hash`, with or without `#`) points to. */
export function matchRoute(hash: string, routes: readonly RouteDef[] = ROUTES): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith('/')) return { id: HOME, path: '/', params: {}, query: {} }
  const q = raw.indexOf('?')
  const path = normalize(q === -1 ? raw : raw.slice(0, q))
  const query = Object.fromEntries(new URLSearchParams(q === -1 ? '' : raw.slice(q + 1)))
  for (const route of routes) {
    const params = matchPattern(route.pattern, path)
    if (params) return { id: route.id as RouteId, path, params, query }
  }
  return { id: 'not-found', path, params: {}, query }
}

/** The hash for a path and query, e.g. hrefFor('/', { char: '学' }) → `#/?char=%E5%AD%A6`. */
export function hrefFor(path: string, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString()
  return `#${normalize(path)}${qs ? `?${qs}` : ''}`
}

/** Free practice of one character, by its code point in lowercase hex: 学 → `#/luyen/5b66`. */
export function practiceHref(char: string): string {
  return `#/luyen/${(char.codePointAt(0) ?? 0).toString(16)}`
}

/** The character a practice route names (`5b66` → 学); null unless it is one Han character. */
export function charFromHex(hex: string): string | null {
  if (!/^[0-9a-f]{4,6}$/.test(hex)) return null
  const cp = parseInt(hex, 16)
  if (cp > 0x10ffff) return null
  const char = String.fromCodePoint(cp)
  return /^\p{Script=Han}$/u.test(char) ? char : null
}

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const want = normalize(pattern).split('/')
  const got = path.split('/')
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      if (got[i] === '') return null
      try {
        params[want[i].slice(1)] = decodeURIComponent(got[i])
      } catch {
        return null
      }
    } else if (want[i] !== got[i]) {
      return null
    }
  }
  return params
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = () => window.location.hash

/** The current route; re-renders on hash changes only. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return matchRoute(hash)
}

// ── Where "back" goes from a full-screen practice ────────────────────────────

let returnTo = '#/'

/** The shell notes every screen that is not a practice: leaving a practice returns there. */
export function rememberReturn(hash: string): void {
  returnTo = hash || '#/'
}

/** The last screen before a practice (the home screen when the practice was opened directly). */
export function returnHref(): string {
  return returnTo
}

/**
 * Leaves a full-screen practice for the screen it was opened from: the browser's Back when that is
 * the entry before (so the phone's Back button does not reopen the practice), else that screen in
 * the practice's place.
 */
export function leavePractice(): void {
  goBackTo(returnTo)
}
