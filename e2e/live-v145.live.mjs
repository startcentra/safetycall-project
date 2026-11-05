// /live against the loopback contract simulator: real MP4 playback, real FFmpeg PCM, real WebSocket, labelled fixture text.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('artifacts/v145/screenshots', { recursive: true });
const shot = async (page, name) => {
  const prefix = `artifacts/v145/screenshots/${test.info().project.name}-${name}`;
  await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  if (test.info().project.name.startsWith('mobile')) await page.screenshot({ path: `${prefix}-viewport.png` });
};
const videoTime = page => page.evaluate(() => document.getElementById('video').currentTime);
async function ready(page) { await page.goto('/live'); await expect(page.locator('#answer')).toBeEnabled(); await expect(page.locator('#ready-note')).not.toHaveText('Checking analysis readiness…'); }

test('English by default, provenance legend, simulator labelled, no serious a11y violations', async ({ page }) => {
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#ready-note')).toContainText('Local contract simulator');
  await expect(page.locator('#asr-provider')).toHaveText('Local contract simulator');
  await expect(page.locator('.legend .prov')).toHaveCount(7);
  await expect(page.locator('#consent-text')).toContainText('local simulator');
  const scan = await new AxeBuilder({ page }).analyze();
  const serious = scan.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(serious).toEqual([]);
  await shot(page, 'idle');
});

test('Korean switch translates the page and persists; English restores', async ({ page }) => {
  await ready(page);
  await page.click('button[data-set-lang="ko"]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('#col-intel')).toHaveText('01 · 분석');
  await expect(page.locator('#ready-note')).toContainText('로컬 계약 시뮬레이터');
  await page.reload(); await expect(page.locator('#col-intel')).toHaveText('01 · 분석');
  await page.click('button[data-set-lang="en"]');
  await expect(page.locator('#col-intel')).toHaveText('01 · Intelligence');
});

test('without rights + consent the recording plays as audio only and nothing is analyzed', async ({ page }) => {
  await ready(page);
  await page.locator('#answer').focus(); await page.keyboard.press('Enter');
  await expect.poll(() => videoTime(page), { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.locator('#asr-status')).toHaveText('Audio only');
  await expect(page.locator('#alert-title')).toHaveText('Audio only');
  await expect(page.locator('#events .event')).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('No analysis is running');
  await page.click('#stop');
  await expect(page.locator('#phone-phase')).toHaveText('Call ended');
});

test('blocked playback shows a Play control that recovers', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play; let calls = 0;
    HTMLMediaElement.prototype.play = function () { calls++; return calls <= 2 ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : original.call(this); };
  });
  await ready(page);
  await page.click('#answer');
  await expect(page.locator('#overlay-text')).toHaveText('The browser blocked playback.');
  await page.click('#overlay-btn');
  await expect.poll(() => videoTime(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('consented stream: server events drive transcript, pause sync, SIMULATED_GPS, SafeBank hold and denial', async ({ page }) => {
  await ready(page);
  await page.check('#rights'); await page.check('#consent');
  await expect(page.locator('#consent-hint')).toBeHidden();
  await page.click('#answer');
  await expect(page.locator('#asr-status')).toHaveText('Streaming', { timeout: 20_000 });
  await expect.poll(() => videoTime(page), { timeout: 15_000 }).toBeGreaterThan(1);
  const first = page.locator('#transcript .line.final').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(first).toContainText('Speaker unverified');
  await expect(first).toContainText('[SIM-FIXTURE]');
  await expect(page.locator('.legend .prov.on[data-prov="LOCAL_CONTRACT_SIMULATOR"]')).toHaveCount(1);
  await expect(page.locator('.legend .prov.on[data-prov="ACTUAL_STREAMED_ASR"]')).toHaveCount(0);
  await expect(page.locator('#events')).toContainText('ASR stream ready');

  await page.click('#pause');
  await expect(page.locator('#events')).toContainText('Paused');
  const pausedAt = await videoTime(page); await page.waitForTimeout(1200);
  expect(Math.abs(await videoTime(page) - pausedAt)).toBeLessThan(0.05);
  await page.click('#pause');
  await expect(page.locator('#events')).toContainText('Resumed');

  await expect(page.locator('#events')).toContainText('Simulated GPS point', { timeout: 30_000 });
  await expect(page.locator('#zone-name')).toHaveText('At the bank', { timeout: 40_000 });
  await expect(page.locator('#risk-band')).toHaveText('Voice-phishing signals', { timeout: 40_000 });
  await expect(page.locator('#safety-modal')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#modal-dismiss')).toBeFocused();
  await shot(page, 'hold-modal');
  await page.keyboard.press('Escape');
  await expect(page.locator('#safety-modal')).toBeHidden();
  await expect(page.locator('#gate-status')).toHaveText('Hold ON · high-risk call + bank proximity');
  await expect(page.locator('#signals .signal').first()).toBeVisible();

  await page.click('#transfer');
  await expect(page.locator('#safety-modal')).toBeVisible();
  await page.click('#modal-dismiss');
  await expect(page.locator('#bank-result')).toHaveText('Virtual transfer denied by the server hold.');
  await expect(page.locator('#events')).toContainText('Virtual transfer denied');
  await expect(page.locator('#meta-card')).toContainText('Simulator response, not Meta.', { timeout: 20_000 });
  await expect(page.locator('#hud-title')).not.toHaveText('—');
  await expect(page.locator('#latency')).toContainText('p50');
  await shot(page, 'live');

  const lineTimes = await page.locator('#transcript .line.final').evaluateAll(nodes => nodes.map(n => [Number(n.dataset.start), Number(n.dataset.end)]));
  for (const [start, end] of lineTimes) { expect(end).toBeGreaterThanOrEqual(start); expect(end).toBeLessThanOrEqual(await videoTime(page) * 1000 + 1000); }

  await page.click('#stop');
  await expect(page.locator('#asr-status')).toHaveText(/Stopped|Complete/);
  await expect(page.locator('#seek-hint')).toBeVisible();
  await shot(page, 'review');
});
