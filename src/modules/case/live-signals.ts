/** Deterministic *observational* demo metrics. Not fraud probabilities or emotional measurements.
 * Signals originate only from the canonical assessTriage() checkpoint, never an extra detector.
 */
import type { ActionEvent, SignalCode, TriageSignal } from '../risk-triage/index.ts';

export interface LiveSignalSnapshot {
  urgency: number;
  coercivePressure: number;
  actionProximity: number;
  livePressureIndex: number;
  /** Difference in urgency compared with the previous completed utterance, not a per-second rate. */
  urgencyDelta: number;
  evidenceCodes: SignalCode[];
  currentThreatObserved:boolean;
  timeBasis: 'FINALIZED_UTTERANCE';
  limitations: string[];
}
export type LiveSignalRaw = Omit<LiveSignalSnapshot, 'urgencyDelta'>;

const URGENCY: Partial<Record<SignalCode, number>> = {
  URGENCY: 70, DIRECT_THREAT: 85, SECRECY: 35,
};
const COERCION: Partial<Record<SignalCode, number>> = {
  DIRECT_THREAT: 90, SECRECY: 65, REALITY_UNDERMINING: 50, URGENCY: 30, AUTHORITY_CLAIM: 20,
};
const ACTION: Partial<Record<SignalCode, number>> = {
  MONEY_REQUEST: 85, CREDENTIAL_REQUEST: 95, REMOTE_CONTROL: 90, POST_TRANSFER: 100,
};
function strongest(codes: SignalCode[], weights: Partial<Record<SignalCode, number>>): number {
  return Math.max(0, ...codes.map(code=>weights[code]??0));
}
/** Rule weights are provisional and deliberately explicit; no new detection or model confidence claims. */
export function deriveLiveSignals(signals: readonly TriageSignal[], previousUrgency = 0, actionEvent:ActionEvent='NONE'): LiveSignalSnapshot {
  const codes = [...new Set(signals.map(s=>s.code))];
  const urgency = strongest(codes,URGENCY);
  const coercivePressure = strongest(codes,COERCION);
  const actionProximity = Math.max(strongest(codes,ACTION),actionEvent==='NONE'?0:100);
  // Separately preserve action proximity: calm payment requests can be high risk.
  const livePressureIndex = Math.min(100,Math.round(0.45*urgency + 0.55*coercivePressure));
  return { urgency,coercivePressure,actionProximity,livePressureIndex,
    urgencyDelta: urgency-previousUrgency,evidenceCodes:codes,currentThreatObserved:codes.includes('DIRECT_THREAT'),timeBasis:'FINALIZED_UTTERANCE',
    limitations:['관찰된 표현의 실험적 규칙 점수이며 실제 스트레스 측정·사기 확률이 아닙니다.',
      '최종 발화 단위 변화이며 시간 정보가 없으므로 초당 변화율이 아닙니다.'] };
}
