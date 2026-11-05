import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/v123/playwright-results.json' }], ['html', { outputFolder: 'artifacts/v123/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/v123/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 393, height: 852 },
  },
  webServer: {
    command: 'node --experimental-strip-types demo/safety-challenge/server.mjs',
    url: 'http://127.0.0.1:4175/mobile',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { SAFECALL_DEMO_PORT: '4175' },
  },
  projects: [{ name: 'chromium-393', use: { browserName: 'chromium', viewport: { width: 393, height: 852 } } }],
});
