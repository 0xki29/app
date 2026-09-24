import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILD_INFO, installGlobalErrorHandlers, reportError } from './errorReporting'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportError', () => {
  it('logs the context, the error and the build', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')
    reportError('scoring', err, { char: '永' })
    expect(log).toHaveBeenCalledWith('[scoring]', err, expect.objectContaining({ ...BUILD_INFO, char: '永' }))
    expect(BUILD_INFO.chunk).toMatch(/\S/)
  })
})

describe('installGlobalErrorHandlers', () => {
  it('logs uncaught errors and unhandled rejections until uninstalled', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = new EventTarget()
    const uninstall = installGlobalErrorHandlers(target)
    const err = new Error('uncaught')
    target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: 'uncaught', filename: 'a.js', lineno: 1, colno: 2 }))
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }))
    expect(log).toHaveBeenNthCalledWith(1, '[uncaught]', err, expect.objectContaining({ source: 'a.js:1:2', ...BUILD_INFO }))
    expect(log).toHaveBeenNthCalledWith(2, '[unhandledrejection]', 'nope', expect.objectContaining(BUILD_INFO))
    uninstall()
    target.dispatchEvent(new Event('error'))
    expect(log).toHaveBeenCalledTimes(2)
  })
})
