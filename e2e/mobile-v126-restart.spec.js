/**
 * Browser + actual server process restart regression for SafeCall MOCK.
 * Copy into the project's e2e/ directory. This test launches its OWN isolated local server.
 * It does NOT simulate an internet outage or prove device/screen-reader accessibility.
 * NOT EXECUTED in this ChatGPT environment: Chromium is policy-blocked.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';

const serverFile = resolve('demo/safety-challenge/server.mjs');
async function freeLoopbackPort() {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = s.address().port;
  await new Promise((ok, fail) => s.close(err => err ? fail(err) : ok()));
  return port;
}
async function spawnDemo(port) {
  const child = spawn(process.execPath, ['--experimental-strip-types', serverFile], {
    cwd: process.cwd(), env: { ...process.env, SAFECALL_DEMO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', b => { output = (output + b.toString()).slice(-4000); });
  child.stderr.on('data', b => { output = (output + b.toString()).slice(-4000); });
  const url = `http://127.0.0.1:${port}/mobile`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited prematurely: ${output}`);
    try { const r = await fetch(url, { signal: AbortSignal.timeout(800) }); if (r.ok) return child; } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  child.kill('SIGKILL');
  throw new Error(`Server did not become healthy: ${output}`);
}
async function stopDemo(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2500))]);
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Test server could not be terminated safely');
}
async function storedSession(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('safecall-local-session-v100') || 'null'));
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('safecall-local-session-v100') || 'null');
    if (!s) return null;
    const r = await fetch('/api/state', {headers: {'X-SafeCall-Session':s.sessionId,'X-SafeCall-Token':s.token}});
    return r.ok ? r.json() : null;
  });
}

test('v126: actual process restart locks old session; explicit new session restores safe state', async ({ page }) => {
  test.setTimeout(90_000);
  const port = await freeLoopbackPort();
  const url = `http://127.0.0.1:${port}/mobile`;
  let first = null, second = null, firstPid = null;
  try {
    first = await spawnDemo(port);
    await page.goto(url);
    await expect(page.locator('#mobile-skeleton')).toBeHidden();
    const oldAuth = await storedSession(page);
    const oldState = await snapshot(page);
    expect(oldAuth?.sessionId).toBeTruthy();
    expect(oldState?.runId).toBeTruthy();

    firstPid = first.pid;
    await stopDemo(first);
    first = null;
    second = await spawnDemo(port);
    expect(second.pid).not.toBe(firstPid);
    await page.reload();
    await expect(page.locator('#mobile-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#btn-tx')).toBeDisabled();
    await expect(page.locator('#sb-arrival')).toBeDisabled();
    expect((await storedSession(page)).sessionId).toBe(oldAuth.sessionId);
    expect(await snapshot(page)).toBeNull();

    // No implicit replacement; the user explicitly initiates a new MOCK session.
    await page.locator('#error-new').click();
    await expect(page.locator('#mobile-error')).toBeHidden({ timeout: 15_000 });
    const newAuth = await storedSession(page), newState = await snapshot(page);
    expect(newAuth.sessionId).not.toBe(oldAuth.sessionId);
    expect(newState.runId).not.toBe(oldState.runId);
    expect(newState.safeBank.status).toBe('READY');
    expect(newState.bankArrivalConfirmed).toBe(false);
    expect(newState.bankHelpConsented).toBe(false);
    expect(newState.endedAt).toBeNull();
  } finally {
    await stopDemo(first); await stopDemo(second);
  }
});
