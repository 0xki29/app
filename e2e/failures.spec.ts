import { expect, test } from './fixtures'

// What the learner sees when the browser lets the app down. Each test breaks one browser API
// before the app loads, and expects the one error the app logs for it.

test.describe('no 2D canvas for the writing box', () => {
  test.use({ expectedErrors: [/Canvas 2D is not available/] })

  test('the box says so, and the rest of the app still works', async ({ page }) => {
    // As when iOS refuses new canvases once canvas memory runs out.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
        return this.classList.contains('hw-layer') ? null : original.apply(this, args)
      } as typeof original
    })
    await page.goto('./')
    await expect(page.getByRole('alert')).toContainText('Không vẽ được trong ô viết')
    await expect(page.getByRole('button', { name: 'Tải lại' })).toBeVisible()
    const trace = page.getByRole('tab', { name: 'Tô theo' })
    await trace.click()
    await expect(trace).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('an error inside the app', () => {
  test.use({ expectedErrors: [/^\[app\]/] })

  test('shows the error page instead of a blank one', async ({ page }) => {
    // Media queries are read while the workspace mounts (DPR watch, reduced motion).
    await page.addInitScript(() => {
      window.matchMedia = () => {
        throw new Error('matchMedia broken on purpose')
      }
    })
    await page.goto('./')
    await expect(page.getByRole('alert')).toContainText('Đã xảy ra lỗi')
    await expect(page.getByRole('button', { name: 'Tải lại' })).toBeVisible()
  })
})
