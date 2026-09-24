import { defineConfig } from '@playwright/test'

const ci = !!process.env.CI
// Not vite preview's default (4173): a preview left running for something else is never mistaken
// for this build.
const port = 4180

/**
 * Smoke tests of the production build in the installed Google Chrome (channel 'chrome': nothing to
 * download; GitHub's Ubuntu runners ship it). Phone-sized, with touch: a portrait phone and a short
 * landscape one. The server only previews dist/: `npm run test:e2e` builds first (CI builds in an
 * earlier step), and a server already on the port is an error, never reused — so the build tested
 * is always the one just made.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Every test starts from an empty profile, so the dictionary downloads and indexes its core each
  // time (≈ 2 s of worker CPU): two workers at most on CI, and assertions that wait for it get time
  // on a slow or busy runner (the default 5 s made them flaky under load).
  workers: ci ? 2 : undefined,
  expect: { timeout: 10_000 },
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    channel: 'chrome',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'portrait', use: { viewport: { width: 390, height: 844 } } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
