// Isolated real-process-restart browser test. Unlike the legacy suite, this
// spec launches and kills its own loopback server; no shared webServer is used.
// Run: npm run test:e2e:restart (requires installed Playwright + Chromium).
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',
  testMatch:'**/mobile-v126-restart.spec.js',
  workers:1,
  fullyParallel:false,
  timeout:90_000,
  expect:{timeout:15_000},
  outputDir:'artifacts/v126/restart-test-results',
  reporter:[['list'],['json',{outputFile:'artifacts/v126/restart-results.json'}]],
  use:{browserName:'chromium',viewport:{width:393,height:852},
       screenshot:'only-on-failure',trace:'retain-on-failure'},
});
