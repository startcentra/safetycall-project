import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SHOTS = 'docs/screenshots/v123';
async function serverState(page) {
  return page.evaluate(async () => {
    const raw = sessionStorage.getItem('safecall-local-session-v100');
    if (!raw) return null;
    const s = JSON.parse(raw);
    const r = await fetch('/api/state', { headers: { 'X-SafeCall-Session': s.sessionId, 'X-SafeCall-Token': s.token } });
    return r.json();
  });
}
async function chooseScenario(page, id) {
  await page.getByRole('button', { name: /시연 설정/ }).click();
  await expect(page.getByRole('dialog', { name: /시연 설정/ })).toBeVisible();
  const before = await serverState(page);
  await page.locator(`[data-scenario-option="${id}"]`).click();
  if (before?.scenario?.id === id) { await expect(page.locator('#scenario-sheet')).toBeHidden(); return before; }
  await expect(page.locator('#confirm-sheet')).toBeVisible();
  await page.getByRole('button', { name: '새 사건 시작' }).click();
  await expect.poll(async () => (await serverState(page))?.scenario?.id).toBe(id);
  const after = await serverState(page);
  expect(after.runId).not.toBe(before.runId);
  expect(after.safeBank.status).toBe('READY');
  expect(after.bankArrivalConfirmed).toBe(false);
  expect(after.bankHelpConsented).toBe(false);
  return after;
}
async function answerAndAdvance(page, times) {
  await page.getByRole('button', { name: '전화 데모' }).first().click();
  await page.getByRole('button', { name: '수락' }).click();
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: /다음 발화 듣기/ }).click();
    await page.waitForTimeout(350);
  }
}
async function confirmSheet(page) {
  const sheet = page.locator('#confirm-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: '취소' })).toBeFocused();
  await sheet.getByRole('button', { name: '확인', exact: true }).click();
  await expect(sheet).toBeHidden();
}
async function goTab(page, name) { await page.locator('.tabbar').getByRole('button', { name }).click(); }

test.beforeEach(async ({ page }) => {
  await page.goto('/mobile');
  await expect(page.locator('#connection-bar')).toBeHidden();
  await expect.poll(async () => (await serverState(page))?.runId).toBeTruthy();
});

test('otp UI flow: scenario select -> utterances -> arrival -> consent -> HOLD -> CANCEL (server verified)', async ({ page }) => {
  await chooseScenario(page, 'otp', '인증번호 요청');
  const caseId = (await serverState(page)).runId;
  await answerAndAdvance(page, 4);
  await goTab(page, 'SafeCall');
  await expect(page.locator('#guard-title')).not.toHaveText('보호 대기 중');
  await expect(page.locator('#m-evidence')).not.toContainText('아직 확인된 발화 근거가 없습니다');
  await page.screenshot({ path: `${SHOTS}/otp-guard-393.png` });
  await goTab(page, 'SafeBank');
  await page.getByRole('button', { name: '도착 확인' }).click(); await confirmSheet(page);
  await expect.poll(async () => (await serverState(page))?.bankArrivalConfirmed).toBe(true);
  await page.getByRole('button', { name: '동의' }).click(); await confirmSheet(page);
  await expect.poll(async () => (await serverState(page))?.bankHelpConsented).toBe(true);
  await page.getByRole('button', { name: '보류', exact: true }).click(); await confirmSheet(page);
  await expect(page.locator('#bank-status')).toContainText('가상 송금 보류 중 (서버 승인)');
  let st = await serverState(page);
  expect(st.runId).toBe(caseId); expect(st.safeBank.status).toBe('HELD');
  expect(st.safeBank.activity.filter(a => a.kind === 'HOLD')).toHaveLength(1);
  await page.screenshot({ path: `${SHOTS}/otp-bank-held-393.png` });
  await page.reload(); await expect(page.locator('#connection-bar')).toBeHidden();
  await goTab(page, 'SafeBank');
  await expect(page.locator('#bank-status')).toContainText('가상 송금 보류 중 (서버 승인)');
  await page.getByRole('button', { name: '보류 취소' }).click(); await confirmSheet(page);
  st = await serverState(page);
  expect(st.safeBank.status).toBe('CANCELLED');
  expect(st.safeBank.activity.map(a => a.kind)).toEqual(['HOLD', 'CANCEL']);
});

test('kidnap emergency: consent policy-denied, bank stays READY, no HOLD', async ({ page }) => {
  await chooseScenario(page, 'kidnap', '자녀 납치');
  await answerAndAdvance(page, 3);
  await goTab(page, 'SafeBank');
  await page.getByRole('button', { name: '도착 확인' }).click(); await confirmSheet(page);
  await page.getByRole('button', { name: '동의' }).click(); await confirmSheet(page);
  await expect(page.locator('#inline-alert')).toBeVisible();
  await expect(page.locator('#inline-alert-text')).toContainText('긴급 상황');
  const st = await serverState(page);
  expect(st.risk.emergency).toBe(true); expect(st.bankHelpConsented).toBe(false);
  expect(st.safeBank.status).toBe('READY'); expect(st.safeBank.activity).toHaveLength(0);
  await expect(page.getByRole('button', { name: '보류', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/kidnap-policy-denied-393.png` });
});

test('end case via UI: RESOLVED, commands blocked, new case is isolated', async ({ page }) => {
  const before = await serverState(page);
  await goTab(page, '기록');
  await page.getByRole('button', { name: '사건 종료' }).click();
  await expect(page.locator('#confirm-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-sheet')).toBeHidden();
  expect((await serverState(page)).endedAt).toBeNull();
  await page.getByRole('button', { name: '사건 종료' }).click();
  await page.locator('#confirm-sheet').getByRole('button', { name: '사건 종료' }).click();
  await expect.poll(async () => (await serverState(page))?.endedAt).toBeTruthy();
  await goTab(page, 'SafeCall');
  await expect(page.locator('#guard-phase')).toHaveText('RESOLVED');
  await goTab(page, 'SafeBank');
  await expect(page.getByRole('button', { name: '도착 확인' })).toBeDisabled();
  await goTab(page, '기록');
  await page.getByRole('button', { name: '새 사건 시작' }).click();
  await expect.poll(async () => (await serverState(page))?.runId).not.toBe(before.runId);
  const fresh = await serverState(page);
  expect(fresh.endedAt).toBeNull(); expect(fresh.bankArrivalConfirmed).toBe(false); expect(fresh.safeBank.status).toBe('READY');
  await page.screenshot({ path: `${SHOTS}/new-case-393.png` });
});

test('offline emulation: no false success, no auto-retry, recovery resyncs', async ({ page, context }) => {
  test.setTimeout(90_000);
  await chooseScenario(page, 'otp', '인증번호 요청');
  await answerAndAdvance(page, 2);
  const vBefore = (await serverState(page)).version;
  await context.setOffline(true);
  await expect(page.locator('#connection-bar')).toBeVisible();
  await goTab(page, 'SafeBank');
  await page.getByRole('button', { name: '가상 송금 시도 기록하기' }).click();
  await expect(page.locator('#inline-alert')).toBeVisible();
  await expect(page.locator('#bank-status')).not.toContainText('보류 중');
  await context.setOffline(false);
  await page.locator('#connection-retry').click({ timeout: 3000 }).catch(() => {});
  await expect(page.locator('#connection-bar')).toBeHidden({ timeout: 15000 });
  const st = await serverState(page);
  expect(st.version).toBeGreaterThanOrEqual(vBefore);
  expect(st.review.fakeTransferAttempted).toBe(false);
  await page.screenshot({ path: `${SHOTS}/offline-recovered-393.png` });
});

test('map: denied / inaccurate / mock success / fallback / close deletes position', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, err) => err({ code: 1, message: 'denied' }) }, configurable: true });
  });
  await page.goto('/mobile'); await expect(page.locator('#connection-bar')).toBeHidden();
  await page.getByRole('button', { name: '지도' }).first().click();
  await page.getByRole('button', { name: /지도 열기/ }).click();
  await page.getByRole('button', { name: '내 위치 한 번 조회' }).click();
  await expect(page.locator('#map-status')).toContainText('위치 권한 거부');
  await page.screenshot({ path: `${SHOTS}/map-denied-393.png` });

  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 37.123456, longitude: 127.123456, accuracy: 5000 } }); });
  await page.getByRole('button', { name: '내 위치 한 번 조회' }).click();
  await expect(page.locator('#map-status')).toContainText('부정확');

  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 37.123456, longitude: 127.123456, accuracy: 10 } }); });
  await page.getByRole('button', { name: '내 위치 한 번 조회' }).click();
  await expect(page.locator('#map-status')).toContainText('은행 도착을 의미하지 않습니다');
  const stText = JSON.stringify(await serverState(page));
  expect(stText).not.toContain('37.123456'); expect(stText).not.toContain('127.123456');
  await page.getByRole('button', { name: /지도 닫기/ }).click();
  await expect(page.locator('#map-status')).toContainText('삭제');
});

test('map: unsupported geolocation and timeout callback are handled', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); });
  await page.goto('/mobile'); await expect(page.locator('#connection-bar')).toBeHidden();
  await page.getByRole('button', { name: '지도' }).first().click();
  await page.getByRole('button', { name: /지도 열기/ }).click();
  await page.getByRole('button', { name: '내 위치 한 번 조회' }).click();
  await expect(page.locator('#map-status')).toContainText('위치 서비스를 사용할 수 없습니다');
  await page.evaluate(() => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, err) => setTimeout(() => err({ code: 3, message: 'timeout' }), 50) }, configurable: true }); });
  await page.getByRole('button', { name: '내 위치 한 번 조회' }).click();
  await expect(page.locator('#map-status')).toContainText('위치 권한 거부/실패');
  const stText = JSON.stringify(await serverState(page));
  expect(stText).not.toContain('latitude'); expect(stText).not.toContain('longitude');
});

test('map fallback when OSM fails', async ({ page }) => {
  // Hang the embed request: no load event fires, so the 6s timeout fallback must show.
  await page.route('**://www.openstreetmap.org/**', async () => { await new Promise(r => setTimeout(r, 30000)); });
  await page.goto('/mobile'); await expect(page.locator('#connection-bar')).toBeHidden();
  await page.getByRole('button', { name: '지도' }).first().click();
  await page.getByRole('button', { name: /지도 열기/ }).click();
  await expect(page.locator('#map-fallback')).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole('button', { name: '은행에 도착했다고 직접 확인' })).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/map-fallback-393.png` });
});

test('responsive viewports: no horizontal overflow, screenshots for 6 sizes x 6 screens at 393', async ({ page }) => {
  const sizes = [[320, 720], [360, 780], [393, 852], [430, 932], [768, 1024], [1440, 900]];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload(); await expect(page.locator('#connection-bar')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow at ${w}`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/responsive-home-${w}.png` });
    const settings = page.getByRole('button', { name: /시연 설정/ });
    await expect(settings).toBeVisible();
  }
  await page.setViewportSize({ width: 393, height: 852 });
  for (const [name, file] of [['전화', 'screen-phone'], ['SafeCall', 'screen-guard'], ['SafeBank', 'screen-bank'], ['기록', 'screen-activity']]) {
    await goTab(page, name); await page.screenshot({ path: `${SHOTS}/${file}-393.png` });
  }
  await page.getByRole('button', { name: '홈' }).first().click();
  await page.getByRole('button', { name: '지도' }).first().click();
  await page.screenshot({ path: `${SHOTS}/screen-map-393.png` });
  await page.getByRole('button', { name: '홈' }).first().click();
  await page.screenshot({ path: `${SHOTS}/screen-home-393.png` });
});

test('a11y: axe serious/critical = 0 on main screens, dialog focus + keyboard', async ({ page }) => {
  for (const name of ['홈', 'SafeCall', 'SafeBank', '기록']) {
    await goTab(page, name === '홈' ? '홈' : name);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    expect(bad, `${name}: ${bad.map(b => b.id).join(',')}`).toHaveLength(0);
  }
  await goTab(page, 'SafeBank');
  await page.getByRole('button', { name: '도착 확인' }).click();
  await expect(page.locator('#confirm-sheet').getByRole('button', { name: '취소' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#confirm-sheet').getByRole('button', { name: '확인', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-sheet')).toBeHidden();
  await expect(page.getByRole('button', { name: '도착 확인' })).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/a11y-bank-393.png` });
  // Light theme axe pass on home
  await goTab(page, '홈');
  await page.getByRole('button', { name: /라이트 화면|다크 화면/ }).click();
  const light = await new AxeBuilder({ page }).analyze();
  const lightBad = light.violations.filter(v => ['serious', 'critical'].includes(v.impact));
  expect(lightBad, `light: ${lightBad.map(b => b.id).join(',')}`).toHaveLength(0);
  await page.screenshot({ path: `${SHOTS}/home-light-393.png` });
});

test('invalid transfer input: local error, nothing sent to server', async ({ page }) => {
  const before = await serverState(page);
  await goTab(page, 'SafeBank');
  await page.getByLabel(/금액/).fill('10');
  await page.getByRole('button', { name: '가상 송금 시도 기록하기' }).click();
  await expect(page.locator('#tx-amt-error')).toBeVisible();
  const after = await serverState(page);
  expect(after.version).toBe(before.version); expect(after.review.fakeTransferAttempted).toBe(false);
});
