// The base stylesheet before any screen's own (dict.css, deck.css), which build on its tokens and classes.
import '../styles.css'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { DeckScreen, PracticeScreen, SessionScreen, TodayScreen } from '../deck/screens'
import { lastSearchHref } from '../dict/links'
import { CreditsScreen, DictionarySearchScreen, EntryScreen, PinyinGuideScreen } from '../dict/screens'
import { ErrorBoundary } from './ErrorBoundary'
import { focusLostHeading, pageTitle } from './screen'
import { noteArrival, restoreScroll, trackScroll } from './history'
import { charFromHex, hrefFor, rememberReturn, useRoute, type Route, type RouteId } from './router'

/** The bottom navigation's tabs, and which routes belong to each; practice and session have none. */
type Tab = 'today' | 'search' | 'deck'

const TAB_OF: Record<RouteId, Tab | null> = {
  today: 'today',
  search: 'search',
  entry: 'search',
  pinyin: 'search',
  credits: 'search',
  deck: 'deck',
  session: null,
  practice: null,
  'not-found': 'today',
}

/** The page title per screen; an entry names its word once it is loaded (EntryScreen). */
const TITLE: Record<RouteId, string> = {
  today: 'Hôm nay',
  search: 'Tra cứu',
  entry: 'Mục từ · Tra cứu',
  pinyin: 'Pinyin cho người Việt',
  credits: 'Giới thiệu & nguồn dữ liệu',
  deck: 'Sổ ôn tập',
  session: 'Ôn tập',
  practice: 'Luyện viết',
  'not-found': 'Không tìm thấy trang',
}

/**
 * The app shell: picks the screen for the current route (router.ts) and, on every screen but the
 * full-screen practice (a session, free practice), the bottom navigation — Hôm nay · Tra cứu · Sổ
 * ôn tập. A practice has its own back button; it returns to the last screen that was not one.
 */
export function App() {
  const route = useRoute()
  const tab = TAB_OF[route.id]

  useEffect(() => {
    document.title = pageTitle(TITLE[route.id])
    if (tab !== null) rememberReturn(window.location.hash)
  }, [route.id, route.path, tab])

  useEffect(() => trackScroll(), [])

  // Each history entry notes where it was reached from (for back links), and a screen opens at its
  // top, or, returned to with Back, where it was left (the practice screens lock the page).
  const lastHash = useRef<string | null>(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    noteArrival(lastHash.current)
    lastHash.current = window.location.hash
    const stop = restoreScroll()
    // A new screen takes focus on its heading (a screen reader then says where the learner is),
    // unless something on it has focus already (the search box). Not on the first load.
    const raf = first.current ? 0 : requestAnimationFrame(() => focusLostHeading(document.querySelector<HTMLElement>('.app main h1')))
    first.current = false
    return () => {
      stop()
      cancelAnimationFrame(raf)
    }
  }, [route.path])

  return (
    <div className="app" data-nav={tab !== null || undefined}>
      {/* A screen that fails shows the error page; the navigation stays, so the rest of the app is still reachable. */}
      <ErrorBoundary key={route.path} context="app">
        <Screen route={route} />
      </ErrorBoundary>
      {tab !== null && <BottomNav active={tab} />}
    </div>
  )
}

function Screen({ route }: { route: Route }): ReactNode {
  switch (route.id) {
    case 'today':
      return <TodayScreen />
    case 'search':
      return <DictionarySearchScreen />
    case 'entry':
      return <EntryScreen entryKey={route.params.key} />
    case 'pinyin':
      return <PinyinGuideScreen />
    case 'credits':
      return <CreditsScreen />
    case 'deck':
      return <DeckScreen />
    case 'session':
      return <SessionScreen />
    case 'practice': {
      const char = charFromHex(route.params.hex)
      return char ? <PracticeScreen key={char} char={char} /> : <NotFound />
    }
    case 'not-found':
      return <NotFound />
  }
}

function BottomNav({ active }: { active: Tab }) {
  const items: { tab: Tab; href: string; label: string; icon: ReactNode }[] = [
    { tab: 'today', href: '#/', label: 'Hôm nay', icon: <TodayIcon /> },
    // Back to the last search, so leaving the dictionary and coming back keeps its results.
    { tab: 'search', href: lastSearchHref(), label: 'Tra cứu', icon: <SearchIcon /> },
    { tab: 'deck', href: '#/so-on-tap', label: 'Sổ ôn tập', icon: <DeckIcon /> },
  ]
  return (
    <nav className="appnav" aria-label="Điều hướng chính">
      {items.map((item) => (
        <a key={item.tab} className="appnav__item" href={item.href} aria-current={item.tab === active ? 'page' : undefined}>
          {item.icon}
          <span className="appnav__label">{item.label}</span>
        </a>
      ))}
    </nav>
  )
}

function NotFound() {
  return (
    <main className="error-page">
      <h1 className="error-page__title" tabIndex={-1}>
        Không tìm thấy trang
      </h1>
      <p className="error-page__text">Địa chỉ này không có trong ứng dụng.</p>
      <a className="btn btn--primary" href={hrefFor('/')}>
        Về trang Hôm nay
      </a>
    </main>
  )
}

function TodayIcon() {
  return (
    <svg className="appnav__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="appnav__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </svg>
  )
}

function DeckIcon() {
  return (
    <svg className="appnav__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </svg>
  )
}
