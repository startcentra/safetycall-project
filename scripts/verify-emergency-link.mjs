/**
 * Local-only check: after a threat utterance, which protections move together.
 * No Meta call, no SMS, no real bank.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDemoServer } from '../demo/safety-challenge/server.mjs';

function brief(s) {
  return {
    step: s.step,
    risk: s.risk.band,
    emergency: s.risk.emergency,
    card: s.mockCard.status,
    bank: s.safeBank.status,
    zone: s.location.zone,
    meters: s.location.distanceMeters,
    gate: s.protectionGate.blocked,
    gateReason: s.protectionGate.reason,
    actualBankBlocked: s.protectionGate.actualBankBlocked,
    route: s.intervention.route,
    autoCard: s.intervention.automaticMockCardLock,
    autoMoney: s.intervention.automaticFinancialAction,
    guidance: s.guidance?.primary?.id ?? null,
    metaCalled: s.metaCalled,
    metaStatus: s.metaReview?.status ?? null,
    osSmsBlocked: s.messages.osSmsBlocked,
    nativeSmsBlocked: s.platformCapability.nativeSmsBlocked,
    externalAction: s.externalActionPerformed,
    lockLog: s.log.some(entry => entry.type === 'MOCK_CARD_EMERGENCY_LOCK'),
  };
}

async function open(scenario) {
  const app = createDemoServer({ port: 0, metaConfig: { enabled: false, approved: false, killSwitch: true } });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(base + '/api/session/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: scenario, mode: 'verified' }),
  });
  const data = await created.json();
  const headers = {
    'Content-Type': 'application/json',
    'X-SafeCall-Session': data.sessionCredentials.sessionId,
    'X-SafeCall-Token': data.sessionCredentials.parentToken,
  };
  const post = async (api, body) => {
    const response = await fetch(base + api, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app, post, state: data };
}

async function walk(scenario) {
  const session = await open(scenario);
  const turns = [];
  let state = session.state;
  turns.push({ when: 'start', ...brief(state) });
  try {
    while (state.step < state.scenario.totalSteps) {
      const next = await session.post('/api/advance', { runId: state.runId, expectedVersion: state.version });
      if (next.status !== 200) { turns.push({ when: 'advance-failed', status: next.status, code: next.data.code }); break; }
      state = next.data;
      turns.push({ when: `turn-${state.step}`, ...brief(state) });
    }
    const zones = [];
    for (let step = 0; step < 9; step++) {
      const next = await session.post('/api/location/fixture', { runId: state.runId, expectedVersion: state.version, routeId: 'BANK_APPROACH_V1', step });
      if (next.status !== 200) { zones.push({ step, status: next.status, code: next.data.code }); break; }
      state = next.data;
      zones.push({ step, ...brief(state) });
    }
    const messages = [];
    for (const fixtureId of ['prosecutor-bait', 'family-normal', 'unknown-link']) {
      const received = await session.post('/api/messages/mock-receive', { runId: state.runId, expectedVersion: state.version, fixtureId, consented: true });
      state = received.status === 200 ? received.data : state;
      const entry = state.messages.entries.find(item => item.fixtureId === fixtureId);
      let link = null;
      if (entry?.link) {
        const attempt = await session.post('/api/messages/link-attempt', {
          runId: state.runId, expectedVersion: state.version, messageId: entry.id, attemptId: `msg_attempt_${fixtureId.replaceAll('-', '')}01`,
        });
        state = attempt.status === 200 ? attempt.data : state;
        link = { status: attempt.status, blocked: state.messages.lastAttempt?.blocked ?? null, opened: state.messages.externalLinksOpened };
      }
      messages.push({ fixtureId, receive: received.status, verdict: entry?.verdict ?? received.data.code, link });
    }
    const family = await session.post('/api/verification/request', { runId: state.runId, expectedVersion: state.version });
    if (family.status === 200) state = family.data;
    const proposal = await session.post('/api/ai/tool/propose', {
      runId: state.runId, expectedVersion: state.version,
      proposal: { kind: 'OFFER_MOCK_CARD_LOCK', caseId: state.runId, stateVersion: state.version, cardRef: 'DEMO_CARD_1', evidenceIds: ['turn_1'] },
    });
    const unlock = await session.post('/api/mock-card/command', {
      runId: state.runId, expectedVersion: state.version, action: 'UNLOCK', cardRef: 'DEMO_CARD_1',
      commandId: 'link_unlock', expectedCardRevision: state.mockCard.revision, confirmed: true,
    });
    const hold = await session.post('/api/safebank/command', {
      runId: state.runId, expectedVersion: state.version, type: 'HOLD', commandId: 'link_hold',
      expectedBankRevision: state.safeBank.revision, confirmed: true,
    });
    return {
      scenario, turns, zones, messages,
      family: { status: family.status, code: family.data.code ?? null, verification: family.data.verification?.status ?? null, note: family.data.verification?.note ?? family.data.error ?? null },
      modelProposal: { status: proposal.status, code: proposal.data.code ?? null, cardAfter: (proposal.status === 200 ? proposal.data : state).mockCard.status },
      unlock: { status: unlock.status, code: unlock.data.code ?? null },
      bankHold: { status: hold.status, code: hold.data.code ?? null, bank: state.safeBank.status },
      metaCalled: state.metaCalled,
    };
  } finally {
    await session.app.close();
  }
}

const report = { kidnap: await walk('kidnap'), bail: await walk('bail'), checkedAt: new Date().toISOString() };
const dir = path.resolve('artifacts/cursor-verification');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'emergency-link.json'), JSON.stringify(report, null, 2));
const line = (row) => [row.when ?? row.step, row.risk, row.emergency, row.card, row.zone, row.gate, row.guidance].join(' ');
console.log('KIDNAP TURNS');
for (const row of report.kidnap.turns) console.log(line(row));
console.log('KIDNAP GPS');
for (const row of report.kidnap.zones) console.log(line(row));
console.log('BAIL END', JSON.stringify(report.bail.turns.at(-1)));
console.log('BAIL AT BANK', JSON.stringify(report.bail.zones.at(-1)));
console.log('KIDNAP SIDE', JSON.stringify({ messages: report.kidnap.messages, family: report.kidnap.family, modelProposal: report.kidnap.modelProposal, unlock: report.kidnap.unlock, bankHold: report.kidnap.bankHold, metaCalled: report.kidnap.metaCalled }));
console.log('BAIL SIDE', JSON.stringify({ messages: report.bail.messages, family: report.bail.family, unlock: report.bail.unlock, bankHold: report.bail.bankHold, metaCalled: report.bail.metaCalled }));
