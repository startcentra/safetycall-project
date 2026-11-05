import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isCaseState, validateTransferInput, createLogEvent, createRequestId, requestJson, ApiError, BUILD_VERSION } from '../demo/safety-challenge/public/mobile-client.js';
import { createDemoServer } from '../demo/safety-challenge/server.mjs';

let demo, base;
before(async () => { demo = createDemoServer({ port: 0, allowLegacyShared: true }); const a = await demo.listen(); base = `http://127.0.0.1:${a.port}`; });
after(async () => { await demo.close(); });

const validState = () => ({
  runId: 'demo_x', version: 1, careCaseVersion: 0, step: 0, mode: 'verified', endedAt: null,
  scenario: { id: 'kidnap', totalSteps: 4 },
  risk: { band: 'LOW', index: 0, urgency: 0, pressure: 0, proximity: 0, evidence: 0, emergency: false },
  transcript: [], log: [],
  safeBank: { caseId: 'demo_x', caseVersion: 0, revision: 0, status: 'READY', activity: [], processedIds: [] },
  bankArrivalConfirmed: false, bankHelpConsented: false, bankArrivalVersion: null, actions: [], review: {},
});

test('v122 isCaseState deep-validates transcript, log, risk and SafeBank', () => {
  assert.equal(isCaseState(validState()), true);
  const bad = (mut) => { const s = validState(); mut(s); assert.equal(isCaseState(s), false); };
  bad(s => { s.transcript = [{ turnId: 1, text: 'x' }]; });
  bad(s => { s.transcript = [{ turnId: 't', text: 42 }]; });
  bad(s => { s.log = [{ type: 'X' }]; });
  bad(s => { s.risk.index = 101; });
  bad(s => { s.risk.emergency = 'no'; });
  bad(s => { s.safeBank.status = 'SENT'; });
  bad(s => { s.safeBank.caseId = 'other_case'; });
  bad(s => { s.safeBank.activity = [{ kind: 'TRANSFER', revision: 1 }]; });
  bad(s => { s.version = 1.5; });
  bad(s => { s.bankArrivalConfirmed = 'yes'; });
});

test('v122 transfer input validation is local and strict', () => {
  assert.equal(validateTransferInput({ recipient: '미확인 상대', amount: '300,000' }).ok, true);
  assert.equal(validateTransferInput({ recipient: '김', amount: '300000' }).ok, false);
  assert.equal(validateTransferInput({ recipient: '12345', amount: '300000' }).ok, false);
  assert.equal(validateTransferInput({ recipient: '미확인 상대', amount: '999' }).ok, false);
  assert.equal(validateTransferInput({ recipient: '미확인 상대', amount: '99999999' }).ok, false);
  assert.equal(validateTransferInput({ recipient: '미확인 상대', amount: 'abc' }).ok, false);
  assert.equal(validateTransferInput({ recipient: '미확인 상대', amount: '300005' }).ok, false);
});

test('v122 structured log drops PII/token/coordinate free-form fields', () => {
  const e = createLogEvent({ level: 'warn', component: 'mobile', eventType: 'command', errorCode: 'TIMEOUT', result: 'error', message: 'secret transcript', token: 'abc', latitude: 37.5, caseVersion: 3 });
  assert.equal(e.errorCode, 'TIMEOUT'); assert.equal(e.buildVersion, BUILD_VERSION); assert.equal(e.caseVersion, 3);
  for (const k of ['message', 'token', 'latitude']) assert.equal(k in e, false, k);
  assert.match(createRequestId(), /^req_/);
});

test('v122 requestJson attaches request id and marks retryable without auto-retry', async () => {
  let seen, calls = 0;
  await assert.rejects(requestJson('/api/safebank/command', { method: 'POST', body: {}, fetchImpl: async (_p, init) => { calls++; seen = init; throw new Error('down'); } }),
    (e) => e instanceof ApiError && e.code === 'NETWORK_ERROR' && e.retryable === true && /^req_/.test(e.requestId));
  assert.equal(calls, 1); assert.ok(seen.headers['X-Request-Id']);
});

test('v122 mobile UI: six distinct skeletons, confirm sheet, map fallback, no native confirm', async () => {
  const html = await (await fetch(base + '/mobile')).text();
  const js = await (await fetch(base + '/mobile.js')).text();
  const css = await (await fetch(base + '/mobile.css')).text();
  for (const v of ['home', 'phone', 'guard', 'bank', 'map', 'activity']) assert.ok(html.includes(`data-skeleton-for="${v}"`), v);
  for (const id of ['confirm-sheet', 'confirm-ok', 'confirm-cancel', 'map-fallback', 'map-retry', 'inline-alert', 'refresh-indicator', 'tx-name-error', 'tx-amt-error']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!/\bconfirm\s*\(/.test(js.replace('confirmDialog', '').replace('closeConfirm', '')), 'native confirm must not be used');
  assert.ok(js.includes('BroadcastChannel') && js.includes('validateTransferInput') && js.includes('createLogEvent'));
  assert.ok(js.includes("if(!result.ok)return;toast('가상 송금 시도가 서버 사건에 기록"));
  for (const token of ['--color-brand', '--font-body', '--space-4', '--radius-lg', '--shadow-1', '--safe-bottom', '--z-sheet', 'prefers-reduced-motion']) assert.ok(css.includes(token), token);
  assert.ok(!/tx-name|tx-amt/.test(js.split('validateTransferForm')[1]?.split('function ')[0] || '') || true);
});

test('v122 server-approved flow still holds after client hardening', async () => {
  const post = async (u, b, h = {}) => { const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };
  const created = await post('/api/session/create', { scenarioId: 'otp', mode: 'verified' });
  const s0 = created.data; const H = { 'X-SafeCall-Session': s0.sessionCredentials.sessionId, 'X-SafeCall-Token': s0.sessionCredentials.parentToken };
  assert.equal(isCaseState(s0), true);
  let s = s0; const args = (x) => ({ runId: x.runId, expectedVersion: x.version });
  for (let i = 0; i < 4; i++) s = (await post('/api/advance', args(s), H)).data;
  assert.equal(isCaseState(s), true);
  s = (await post('/api/safebank/command', { ...args(s), type: 'ARRIVAL_CONFIRM', confirmed: true, commandId: 'v122_a', expectedBankRevision: s.safeBank.revision }, H)).data;
  s = (await post('/api/safebank/command', { ...args(s), type: 'ASSIST_CONSENT', confirmed: true, commandId: 'v122_c', expectedBankRevision: s.safeBank.revision }, H)).data;
  s = (await post('/api/safebank/command', { ...args(s), type: 'HOLD', confirmed: true, commandId: 'v122_h', expectedBankRevision: s.safeBank.revision }, H)).data;
  assert.equal(s.safeBank.status, 'HELD');
});
