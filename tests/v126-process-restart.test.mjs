/**
 * SafeCall v1.26: real OS child-process restart, not an in-memory server recreation.
 * This verifies backend session behavior only. It DOES NOT prove browser UI behavior,
 * VoiceOver/TalkBack accessibility, real browser zoom, or physical network outages.
 * No authorization tokens are written to stdout or test artifacts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';

const entry = resolve('demo/safety-challenge/server.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getUnusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(err => err ? reject(err) : resolveClose()));
  return port;
}
async function bootServer(port) {
  const child = spawn(process.execPath, ['--experimental-strip-types', entry], {
    cwd: process.cwd(),
    env: { ...process.env, SAFECALL_DEMO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exitError = '';
  child.on('error', e => { exitError = e.message; });
  // Capture only bounded startup information (never authorization values).
  let startup = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', buf => { startup = (startup + buf.toString()).slice(-2000); });
  }
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 85; i++) {
    if (child.exitCode !== null || child.signalCode !== null || exitError) throw new Error(`MOCK server exited: ${exitError || startup}`);
    try {
      const res = await fetch(base + '/mobile', { signal: AbortSignal.timeout(500) });
      if (res.status === 200) return {child, base};
    } catch { /* startup race: try until bounded deadline */ }
    await sleep(100);
  }
  await stopServer(child);
  throw new Error('MOCK server did not start within 9s');
}
async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  const result = await Promise.race([exited.then(() => 'exited'), sleep(2500).then(() => 'timeout')]);
  if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(2500)]);
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'old process must terminate before restart');
}
const headers = credentials => ({
  'X-SafeCall-Session': credentials.sessionId,
  'X-SafeCall-Token': credentials.parentToken,
});
async function makeSession(base, scenarioId='otp') {
  const r = await fetch(base + '/api/session/create', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({scenarioId, mode:'verified'}),
    signal:AbortSignal.timeout(4000),
  });
  assert.equal(r.status,201);
  return await r.json();
}

test('v126 OS process restart: old credentials rejected; fresh case only on explicit create', {timeout:35000}, async () => {
  const port = await getUnusedPort();
  let first, second;
  try {
    first = (await bootServer(port)).child;
    const base = `http://127.0.0.1:${port}`;
    const original = await makeSession(base);
    const auth = original.sessionCredentials;
    assert.ok(original.runId && auth.sessionId && auth.parentToken);
    let r = await fetch(base + '/api/state', {headers:headers(auth)});
    assert.equal(r.status,200);
    assert.equal((await r.json()).runId, original.runId);
    const firstPid = first.pid;

    await stopServer(first);
    first = null;
    second = (await bootServer(port)).child;
    assert.notEqual(second.pid, firstPid, 'restart must use a different process');

    // There is no endpoint that should auto-rehydrate a previous MOCK case.
    r = await fetch(base + '/api/state', {headers:headers(auth)});
    assert.equal(r.status,403, 'old credentials must NOT regain access');
    const rejected = await r.json();
    assert.equal(rejected.code,'FORBIDDEN');
    r = await fetch(base + '/api/state');
    assert.equal(r.status,403, 'unauthenticated state access must not create a case');
    // A previous caller must not be able to mutate by reusing old credentials.
    r = await fetch(base + '/api/advance', {
      method:'POST', headers:{...headers(auth),'Content-Type':'application/json'},
      body:JSON.stringify({runId:original.runId,expectedVersion:original.version}),
    });
    assert.equal(r.status,403, 'old session cannot run commands');

    const fresh = await makeSession(base, 'kidnap');
    assert.notEqual(fresh.runId, original.runId);
    assert.notEqual(fresh.sessionCredentials.sessionId, auth.sessionId);
    assert.equal(fresh.safeBank.status, 'READY');
    assert.equal(fresh.bankArrivalConfirmed, false);
    assert.equal(fresh.bankHelpConsented, false);
    assert.equal(fresh.endedAt, null);
    r = await fetch(base + '/api/state', {headers:headers(fresh.sessionCredentials)});
    assert.equal(r.status,200);
    assert.equal((await r.json()).runId,fresh.runId);
    // Never log credentials. Assertions above prove identity separation locally.
  } finally {
    if (first) await stopServer(first);
    if (second) await stopServer(second);
  }
});
