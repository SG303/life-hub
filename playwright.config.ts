import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against Life Hub behind a local TLS proxy (like Tailscale Serve).
 * E2E_APP=node (default) runs `dist/server/server.js`; E2E_APP=docker runs the
 * `life-hub:test` image (build it first). Run `npm run build` before node mode.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'https://127.0.0.1:4643',
    ignoreHTTPSErrors: true,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
});
