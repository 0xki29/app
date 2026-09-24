import { describe, expect, it } from 'vitest'
import { charFromHex, hrefFor, matchRoute, practiceHref, rememberReturn, returnHref, type RouteDef } from './router'

describe('matchRoute', () => {
  it('opens the home screen (Hôm nay) without a hash, at #/, and for in-page anchors', () => {
    for (const hash of ['', '#', '#/', '/', '#main']) expect(matchRoute(hash).id).toBe('today')
  })

  it('ignores a trailing slash and reads the query', () => {
    expect(matchRoute('#/?char=%E5%AD%A6&mode=recall')).toMatchObject({ id: 'today', path: '/', query: { char: '学', mode: 'recall' } })
    expect(matchRoute('#/tra-cuu/?q=hoc')).toMatchObject({ id: 'search', path: '/tra-cuu', query: { q: 'hoc' } })
  })

  it('reports an unknown path as not found', () => {
    expect(matchRoute('#/nowhere')).toMatchObject({ id: 'not-found', path: '/nowhere' })
    expect(matchRoute('#/luyen')).toMatchObject({ id: 'not-found' })
    expect(matchRoute('#/luyen/5b66/extra').id).toBe('not-found')
  })

  it('knows every screen of the app', () => {
    expect(matchRoute('#/tra-cuu').id).toBe('search')
    expect(matchRoute('#/pinyin').id).toBe('pinyin')
    expect(matchRoute('#/nguon-du-lieu').id).toBe('credits')
    expect(matchRoute('#/so-on-tap').id).toBe('deck')
    expect(matchRoute('#/on-tap').id).toBe('session')
    expect(matchRoute('#/luyen/5b66')).toMatchObject({ id: 'practice', params: { hex: '5b66' } })
  })

  it('decodes an entry key, whatever it contains', () => {
    const key = '學生|学生[xue2 sheng5]'
    expect(matchRoute(`#/tu/${encodeURIComponent(key)}`)).toMatchObject({ id: 'entry', params: { key } })
    const odd = 'AA制|AA制[A A zhi4]'
    expect(matchRoute(`#/tu/${encodeURIComponent(odd)}?from=search`)).toMatchObject({ params: { key: odd }, query: { from: 'search' } })
  })

  it('captures and decodes :params', () => {
    const routes: RouteDef[] = [
      { id: 'today', pattern: '/' },
      { id: 'entry', pattern: '/tu-dien/:word' },
    ]
    expect(matchRoute('#/tu-dien/%E5%AD%A6%E4%B9%A0/', routes)).toMatchObject({ id: 'entry', params: { word: '学习' } })
    expect(matchRoute('#/tu-dien/', routes).id).toBe('not-found')
    expect(matchRoute('#/tu-dien/%E0%A4%A', routes).id).toBe('not-found')
  })
})

describe('hrefFor', () => {
  it('builds hashes that match back', () => {
    const href = hrefFor('/', { char: '學' })
    expect(href).toBe('#/?char=%E5%AD%B8')
    expect(matchRoute(href).query).toEqual({ char: '學' })
    expect(hrefFor('/')).toBe('#/')
  })
})

describe('practice routes', () => {
  it('name a character by its code point, and read it back', () => {
    for (const ch of ['学', '學', '永', '𠀀']) {
      const route = matchRoute(practiceHref(ch))
      expect(route.id).toBe('practice')
      expect(charFromHex(route.params.hex)).toBe(ch)
    }
    expect(practiceHref('学')).toBe('#/luyen/5b66')
  })

  it('refuse what is not one Han character', () => {
    for (const hex of ['41', '0041', 'zz', '5B66', '110000', '', '5b66f0']) expect(charFromHex(hex)).toBeNull()
  })
})

describe('returnHref', () => {
  it('is the last screen noted, home until one is', () => {
    expect(returnHref()).toBe('#/')
    rememberReturn('#/tra-cuu?q=hoc')
    expect(returnHref()).toBe('#/tra-cuu?q=hoc')
    rememberReturn('')
    expect(returnHref()).toBe('#/')
  })
})
