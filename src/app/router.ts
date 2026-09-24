import { useSyncExternalStore } from 'react'

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

export const ROUTES = [{ id: 'practice', pattern: '/' }] as const satisfies readonly RouteDef[]

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

/** The route a location hash (`location.hash`, with or without `#`) points to. */
export function matchRoute(hash: string, routes: readonly RouteDef[] = ROUTES): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith('/')) return { id: 'practice', path: '/', params: {}, query: {} }
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
