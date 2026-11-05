import { test, expect } from '@playwright/test';

// Browser verification for session invalidation and explicit replacement.
// These tests must run with Chromium; API-only tests are not a substitute.
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('safecall-local-session-v100') || 'null'));
const state = page => page.evaluate(async () => {
  const s = JSON.parse(sessionStorage.getItem('safecall-local-session-v100') || 'null');
  if (!s) return null;
  const r = await fetch('/api/state',{headers:{'X-SafeCall-Session':s.sessionId,'X-SafeCall-Token':s.token}});
  return r.ok ? r.json() : null;
});

async function simulateExpiredState(page) {
  await page.route('**/api/state', route => route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',error:'세션 접근이 거부되었습니다.'})}));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#mobile-error')).toBeVisible();
  await expect(page.locator('#error-new')).toBeEnabled();
}

test('v124: unauthorized previous session is locked until explicit user-created replacement', async ({page}) => {
  await page.goto('/mobile');
  await expect(page.locator('#mobile-skeleton')).toBeHidden();
  const before=await session(page); const beforeState=await state(page);
  expect(before?.sessionId).toBeTruthy();expect(beforeState?.runId).toBeTruthy();
  await simulateExpiredState(page);
  await expect(page.locator('#btn-tx')).toBeDisabled();
  await expect(page.locator('#sb-arrival')).toBeDisabled();
  expect((await session(page)).sessionId).toBe(before.sessionId);
  await page.unroute('**/api/state');
  await page.locator('#error-new').click();
  await expect(page.locator('#mobile-error')).toBeHidden();
  const after=await session(page),fresh=await state(page);
  expect(after.sessionId).not.toBe(before.sessionId);
  expect(fresh.runId).not.toBe(beforeState.runId);
  expect(fresh.safeBank.status).toBe('READY');
  expect(fresh.bankArrivalConfirmed).toBe(false);
  expect(fresh.bankHelpConsented).toBe(false);
});

test('v124: failed replacement does not erase previous session credentials', async ({page}) => {
  await page.goto('/mobile');
  await expect(page.locator('#mobile-skeleton')).toBeHidden();
  const before=await session(page);
  await simulateExpiredState(page);
  await page.unroute('**/api/state');
  await page.route('**/api/session/create', route=>route.abort('failed'));
  await page.locator('#error-new').click();
  await expect(page.locator('#mobile-error')).toBeVisible();
  expect((await session(page)).sessionId).toBe(before.sessionId);
  await page.unroute('**/api/session/create');
  await page.locator('#error-new').click();
  await expect(page.locator('#mobile-error')).toBeHidden();
  expect((await session(page)).sessionId).not.toBe(before.sessionId);
});
