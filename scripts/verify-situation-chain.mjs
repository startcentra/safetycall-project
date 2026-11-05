/**
 * Checks whether simulated GPS, card lock, message quarantine, and family
 * safety guidance are wired to a live Meta response. Does not send SMS,
 * place calls, or touch a real bank. Logs codes only.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LiveMetaProvider } from '../src/modules/analysis/meta-provider.ts';
import { ACTION_CODES } from '../src/modules/analysis/meta-contract.ts';
import { estimateSparkUsd } from '../src/modules/cost/guard.ts';
import { routePointForStep, protectionDecision, contextLocationObservation } from '../demo/safety-challenge/live-journey.mjs';
import { createMockCardState, applyMockCardCommand } from '../src/modules/mock-banking/mock-card-ledger.ts';
import { classifyMessage, MESSAGE_FIXTURES } from '../src/modules/message-safety/index.ts';
import { NATIVE_MESSAGE_ADAPTER } from '../src/modules/message-safety/ports.ts';
import { createCase, applyCaseEvent } from '../src/modules/case/index.ts';
import { selectLiveGuidance } from '../src/modules/playbook/select.ts';
import { cardById } from '../src/modules/playbook/cards.ts';
import { deriveIntervention } from '../src/modules/policy/intervention.ts';
import { evaluateToolProposal } from '../src/modules/analysis/tool-proposals.ts';
import { assessTriage } from '../src/modules/risk-triage/index.ts';

const bankTurns = [
  { turnId: 't1', speaker: 'caller', text: '계좌가 도용됐으니 가족에게는 비밀로 하세요.' },
  { turnId: 't2', speaker: 'caller', text: '지금 은행으로 이동해서 안전 계좌로 이체하세요.' },
];
const familyTurns = [
  { turnId: 't1', speaker: 'caller', text: '아들을 데리고 있습니다. 경찰에 말하면 위험합니다.' },
  { turnId: 't2', speaker: 'caller', text: '몸값을 지정 계좌로 지금 송금하세요.' },
];
const dinnerTurns = [
  { turnId: 't1', speaker: 'caller', text: '오늘 저녁에 집에서 볼까요?' },
  { turnId: 't2', speaker: 'caller', text: '은행 앞을 지나가면 연락할게요.' },
];
const zones = [
  { zone: 'AWAY', distanceBand: 'FAR' },
  { zone: 'NEAR_BANK', distanceBand: 'NEAR' },
  { zone: 'AT_BANK', distanceBand: 'ARRIVED' },
];

function localChain() {
  const route = [];
  for (let step = 0; step < 9; step++) {
    const location = routePointForStep(step);
    const observation = contextLocationObservation(location);
    route.push({
      step, zone: location.zone, meters: location.distanceMeters,
      sentToModel: observation,
      holdIfRulesHigh: protectionDecision({ riskBand: 'HIGH', location }).blocked,
      holdIfRulesLow: protectionDecision({ riskBand: 'LOW', location }).blocked,
      actualBankBlocked: protectionDecision({ riskBand: 'HIGH', location }).actualBankBlocked,
    });
  }
  let card = createMockCardState('caseverify01');
  const refused = applyMockCardCommand(card, { id: 'lock1', caseId: 'caseverify01', cardRef: 'DEMO_CARD_1', action: 'LOCK', expectedRevision: 0, userConfirmed: false, caseOpen: true });
  const locked = applyMockCardCommand(card, { id: 'lock2', caseId: 'caseverify01', cardRef: 'DEMO_CARD_1', action: 'LOCK', expectedRevision: 0, userConfirmed: true, caseOpen: true });
  card = locked.state;
  const messages = {};
  for (const id of Object.keys(MESSAGE_FIXTURES)) {
    const low = classifyMessage(id, { caseRiskBand: 'LOW' });
    const high = classifyMessage(id, { caseRiskBand: 'HIGH' });
    messages[id] = { low: low.verdict, high: high.verdict, externalNavigation: low.externalNavigation };
  }
  let nativeBlock = 'DID_NOT_THROW';
  try { NATIVE_MESSAGE_ADAPTER.blockThirdPartyLink(); } catch (error) { nativeBlock = error.message; }
  let nativeRead = 'DID_NOT_THROW';
  try { NATIVE_MESSAGE_ADAPTER.readSms(); } catch (error) { nativeRead = error.message; }
  const family = caseFor([
    '아들을 데리고 있습니다.',
    '경찰에 말하면 위험합니다.',
    '몸값을 지정 계좌로 송금하세요.',
  ]);
  const familyGuide = selectLiveGuidance({ caseState: family, jurisdiction: 'KR', familyContactStatus: 'NOT_REQUESTED' });
  const familyCard = cardById(familyGuide.primary.id);
  const money = caseFor(['안전 계좌로 지금 이체하세요.']);
  const moneyGuide = selectLiveGuidance({ caseState: money, jurisdiction: 'KR' });
  const intervention = deriveIntervention(money, { cardDetailsExposedByUser: false });
  const proposal = evaluateToolProposal({
    kind: 'OFFER_MOCK_CARD_LOCK', caseId: money.caseId, stateVersion: money.version,
    evidenceIds: money.checkpoint.turns.filter(turn => turn.signals.length).map(turn => turn.turnId), cardRef: 'DEMO_CARD_1',
  }, money, money.version, { cardExposureReported: false });
  return {
    gpsRoute: route,
    modelCanChangeSafeBankHold: false,
    card: { withoutUserConfirm: refused.reason, withUserConfirm: locked.reason, status: card.status, realPanAccepted: false },
    messages, nativeBlock, nativeRead,
    familyGuidance: { primary: familyGuide.primary.id, secondary: familyGuide.secondary?.id ?? null, forbidden: familyCard?.forbiddenActions ?? [], allowedTools: familyCard?.allowedTools ?? [] },
    transferGuidance: moneyGuide.primary.id,
    intervention,
    cardProposalWithoutExposure: proposal,
    metaActionEnum: ACTION_CODES,
    metaHasCardLockTool: ACTION_CODES.includes('LOCK_CARD'),
    metaHasSmsTool: ACTION_CODES.some(code => /SMS|MESSAGE|CALL_FAMILY/.test(code)),
  };
}
function caseFor(lines) {
  let state = createCase('caseverify01');
  lines.forEach((text, index) => {
    state = applyCaseEvent(state, { type: 'UTTERANCE_FINAL', caseId: state.caseId, eventId: `e${index}`, turnId: `t${index + 1}`, revision: 0, absoluteIndex: index, speaker: 'caller', text });
  });
  return state;
}

const local = localChain();
const ruleBank = assessTriage({ turns: bankTurns.map(turn => ({ speaker: turn.speaker, text: turn.text })) });
const ruleFamily = assessTriage({ turns: familyTurns.map(turn => ({ speaker: turn.speaker, text: turn.text })) });
const ruleDinner = assessTriage({ turns: dinnerTurns.map(turn => ({ speaker: turn.speaker, text: turn.text })) });
let spent = 0;
const live = [];
const key = process.env.MODEL_API_KEY ?? '';
if (key.trim().length >= 12 && !process.argv.includes('--local-only')) {
  const provider = new LiveMetaProvider({ apiKey: key, timeoutMs: 30000, sourceContext: 'SYNTHETIC_SCRIPTED_TEXT' });
  const jobs = [
    ...zones.map(zone => ({ id: `bank-${zone.zone}`, turns: bankTurns, location: { source: 'SIMULATED_GPS', ...zone } })),
    { id: 'family-kidnap-at-bank', turns: familyTurns, location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' } },
    { id: 'dinner-at-bank', turns: dinnerTurns, location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' } },
  ];
  for (const job of jobs) {
    const result = await provider.analyze({ input: { turns: job.turns, actionEvent: 'NONE', locationObservation: job.location }, triage: { signals: [] } });
    const usd = result.usage.inputTokens === null || result.usage.outputTokens === null ? 0.05 : estimateSparkUsd(result.usage.inputTokens, result.usage.outputTokens);
    spent += usd;
    live.push({
      id: job.id, zone: job.location.zone, riskLevel: result.analysis.riskLevel,
      emergencyFlag: result.analysis.emergencyFlag, actions: result.analysis.recommendedActionCodes,
      signals: result.analysis.detectedSignals, usd, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    });
    console.log(`${job.id} -> ${result.analysis.riskLevel} ${result.analysis.recommendedActionCodes.join(',')} usd=${usd.toFixed(5)}`);
  }
}
const report = {
  createdAt: new Date().toISOString(),
  estimatedSparkUsd: spent,
  priceNote: 'Local Spark estimate for these calls only, not a Meta invoice.',
  structural: local,
  rules: { bank: ruleBank.riskBand, family: ruleFamily.riskBand, dinner: ruleDinner.riskBand },
  live,
};
const out = path.join(process.cwd(), 'artifacts', 'meta-budget', 'situation-chain.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`LOCAL_ZONES=${local.gpsRoute.map(point => point.zone).join('>')} CARD=${local.card.withUserConfirm} FAMILY=${local.familyGuidance.primary} ESTIMATED_USD=${spent.toFixed(4)}`);
