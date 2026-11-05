import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, resolveErrorCode } from '../demo/safety-challenge/public/mobile-client.js';
import { createDemoServer } from '../demo/safety-challenge/server.mjs';

let demo, base, H, S;
const post = async (u, b) => { const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };
const args = (s) => ({ runId: s.runId, expectedVersion: s.version });
before(async () => {
  demo = createDemoServer({ port: 0, allowLegacyShared: true }); const a = await demo.listen(); base = `http://127.0.0.1:${a.port}`;
  const r = await fetch(base + '/api/session/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: 'kidnap', mode: 'verified' }) });
  S = await r.json(); H = { 'X-SafeCall-Session': S.sessionCredentials.sessionId, 'X-SafeCall-Token': S.sessionCredentials.parentToken };
});
after(async () => { await demo.close(); });

test('v123 resolveErrorCode prefers trusted server code, falls back to HTTP', () => {
  assert.equal(resolveErrorCode(409, 'POLICY_DENIED'), 'POLICY_DENIED');
  assert.equal(resolveErrorCode(409, 'CASE_VERSION_CONFLICT'), 'CASE_VERSION_CONFLICT');
  assert.equal(resolveErrorCode(409, 'EMERGENCY_LOCK'), 'EMERGENCY_LOCK');
  assert.equal(resolveErrorCode(409, 'PROXIMITY_LOCK'), 'PROXIMITY_LOCK');
  assert.equal(resolveErrorCode(409, undefined), 'VERSION_CONFLICT');
  assert.equal(resolveErrorCode(409, 'EVIL_CODE'), 'VERSION_CONFLICT');
  assert.equal(resolveErrorCode(400, 'VALIDATION_ERROR'), 'VALIDATION_ERROR');
});

test('v123 server: stale version returns CASE_VERSION_CONFLICT with human message', async () => {
  const r = await post('/api/advance', { runId: S.runId, expectedVersion: 999 });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'CASE_VERSION_CONFLICT'); assert.equal(typeof r.data.error, 'string');
});

test('v123 server: kidnap emergency consent returns POLICY_DENIED, bank unchanged', async () => {
  let s = S;
  for (let i = 0; i < 3; i++) s = (await post('/api/advance', args(s))).data;
  s = (await post('/api/safebank/command', { ...args(s), type: 'ARRIVAL_CONFIRM', confirmed: true, commandId: 'v123_arr', expectedBankRevision: s.safeBank.revision })).data;
  const denied = await post('/api/safebank/command', { ...args(s), type: 'ASSIST_CONSENT', confirmed: true, commandId: 'v123_con', expectedBankRevision: s.safeBank.revision });
  assert.equal(denied.status, 409); assert.equal(denied.data.code, 'POLICY_DENIED');
  const afterState = await (await fetch(base + '/api/state', { headers: H })).json();
  assert.equal(afterState.safeBank.status, 'READY'); assert.equal(afterState.bankHelpConsented, false);
  S = afterState;
});

test('v123 server: ended case returns CASE_ENDED; validation returns VALIDATION_ERROR', async () => {
  const ended = (await post('/api/end', args(S))).data; S = ended;
  const r = await post('/api/advance', args(S));
  assert.equal(r.status, 409); assert.equal(r.data.code, 'CASE_ENDED');
  const bad = await fetch(base + '/api/session/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: 'nope', mode: 'verified' }) });
  const badData = await bad.json(); assert.equal(badData.code, 'VALIDATION_ERROR');
});

test('v123 client requestJson surfaces POLICY_DENIED code', async () => {
  const mock = (status, value) => ({ status, ok: false, headers: { get: () => 'application/json' }, json: async () => value });
  await assert.rejects(requestJson('/api/safebank/command', { method: 'POST', body: {}, fetchImpl: async () => mock(409, { error: '정책 거절', code: 'POLICY_DENIED' }) }),
    (e) => e.code === 'POLICY_DENIED');
  await assert.rejects(requestJson('/api/advance', { method: 'POST', body: {}, fetchImpl: async () => mock(409, { error: '충돌' }) }),
    (e) => e.code === 'VERSION_CONFLICT');
});
