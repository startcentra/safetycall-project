import { defineConfig } from '@playwright/test';

// /live E2E against LOOPBACK contract simulator (no external AI, no real recordings).
// Audio-only WAV is portable. Browser automation still requires installed Playwright + browser.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.live.mjs',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/v145/playwright-live-results.json' }]],
  outputDir: 'artifacts/v145/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    channel: process.env.SAFECALL_E2E_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [{
    command: 'node --experimental-strip-types scripts/e2e-live-server.mjs',
    url: 'http://127.0.0.1:4177/live',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { SAFECALL_DEMO_PORT: '4177', SAFECALL_E2E_FIXTURE: '1', SAFECALL_E2E_GPS_FAST: '1' },
  }, {
    command: 'node --experimental-strip-types scripts/e2e-live-server.mjs',
    url: 'http://127.0.0.1:4178/live',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { SAFECALL_DEMO_PORT: '4178', SAFECALL_E2E_META_GATE: '1' },
  }],
  projects: [
    { name: 'desktop-1600', use: { viewport: { width: 1600, height: 1000 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
});
