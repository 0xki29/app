import { describe, expect, it } from 'vitest'
import { hrefFor, matchRoute, type RouteDef } from './router'

describe('matchRoute', () => {
  it('opens the practice screen without a hash, at #/, and for in-page anchors', () => {
    for (const hash of ['', '#', '#/', '/', '#main']) expect(matchRoute(hash).id).toBe('practice')
  })

  it('ignores a trailing slash and reads the query', () => {
    expect(matchRoute('#/?char=%E5%AD%A6&mode=recall')).toMatchObject({ id: 'practice', path: '/', query: { char: '学', mode: 'recall' } })
  })

  it('reports an unknown path as not found', () => {
    expect(matchRoute('#/nowhere')).toMatchObject({ id: 'not-found', path: '/nowhere' })
  })

  it('captures and decodes :params', () => {
    const routes: RouteDef[] = [
      { id: 'practice', pattern: '/' },
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
