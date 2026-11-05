import {
  ACTION_CODES, MANIPULATION_CODES, SIGNAL_CODES,
  type InputTurn, type MetaAnalysisInput, type ModelAssessment,
} from "./meta-contract.ts";

/** Pure validators so the offline tests run without npm dependencies. */
export class MetaValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MetaValidationError"; }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function checkString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function arrayStrings(value: unknown, maxCount: number, maxLen: number): value is string[] {
  return Array.isArray(value) && value.length <= maxCount && value.every(x => typeof x === "string" && x.length <= maxLen);
}
function codes<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return arrayStrings(value, 20, 100) && value.every(item => allowed.includes(item as T));
}
export function validateMetaInput(raw: unknown): MetaAnalysisInput {
  if (!record(raw)) throw new MetaValidationError("요청은 JSON 객체여야 합니다.");
  if (Object.keys(raw).some(k => !["turns", "actionEvent", "locationObservation"].includes(k))) throw new MetaValidationError("허용되지 않은 입력 필드입니다.");
  if (!Array.isArray(raw.turns) || raw.turns.length < 1 || raw.turns.length > 8) throw new MetaValidationError("발화는 1~8개여야 합니다.");
  const ids = new Set<string>();
  const turns: InputTurn[] = raw.turns.map((item, i) => {
    if (!record(item) || Object.keys(item).some(k => !["turnId","speaker","text"].includes(k))) throw new MetaValidationError(`발화 ${i+1}: 입력 구조 오류`);
    if (!checkString(item.turnId, 60) || !/^[a-zA-Z0-9_-]+$/.test(item.turnId) || ids.has(item.turnId)) throw new MetaValidationError("발화 ID는 고유한 영숫자 식별자여야 합니다.");
    ids.add(item.turnId);
    if (!["caller","user","unknown","multiple"].includes(String(item.speaker))) throw new MetaValidationError("발화자 오류");
    if (!checkString(item.text, 800)) throw new MetaValidationError("발화 내용이 비어 있거나 너무 깁니다.");
    return { turnId: item.turnId, speaker: item.speaker as InputTurn["speaker"], text: item.text.trim() };
  });
  const actionEvent = raw.actionEvent === undefined ? "NONE" : raw.actionEvent;
  if (!["NONE", "TRANSFER_PREPARED", "OTP_SHARE_ATTEMPT"].includes(String(actionEvent))) throw new MetaValidationError("지원하지 않는 행동 이벤트");
  let locationObservation: MetaAnalysisInput['locationObservation'];
  if(raw.locationObservation!==undefined){
    const l=raw.locationObservation;
    if(!record(l)||Object.keys(l).some(k=>!['source','zone','distanceBand'].includes(k))||
      l.source!=='SIMULATED_GPS'||!['AWAY','NEAR_BANK','AT_BANK'].includes(String(l.zone))||
      !['FAR','NEAR','ARRIVED'].includes(String(l.distanceBand))||
      (l.zone==='AWAY'&&l.distanceBand!=='FAR')||(l.zone==='NEAR_BANK'&&l.distanceBand!=='NEAR')||
      (l.zone==='AT_BANK'&&l.distanceBand!=='ARRIVED'))throw new MetaValidationError('허용되지 않은 위치 컨텍스트');
    locationObservation={source:'SIMULATED_GPS',zone:l.zone as 'AWAY'|'NEAR_BANK'|'AT_BANK',distanceBand:l.distanceBand as 'FAR'|'NEAR'|'ARRIVED'};
  }
  return { turns, actionEvent: actionEvent as MetaAnalysisInput["actionEvent"], ...(locationObservation?{locationObservation}:{}) };
}
export function validateModelOutput(raw: unknown, turns: InputTurn[]): ModelAssessment {
  if (!record(raw)) throw new MetaValidationError("Meta 모델 출력이 객체가 아닙니다.");
  const keys = ["riskLevel","riskIndex","manipulationIndex","detectedSignals","manipulationTechniques","requestedActions","evidenceUtteranceIds","normalConversationEvidence","uncertainty","recommendedActionCodes","emergencyFlag"];
  if (Object.keys(raw).length !== keys.length || keys.some(k => !(k in raw))) throw new MetaValidationError("Meta 응답 필드가 누락되었거나 잘못되었습니다.");
  if (!["LOW","CAUTION","HIGH","UNKNOWN"].includes(String(raw.riskLevel))) throw new MetaValidationError("위험 단계 오류");
  for (const index of [raw.riskIndex, raw.manipulationIndex]) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 100) throw new MetaValidationError("위험 지수는 정수 0~100만 가능합니다.");
  }
  if (!codes(raw.detectedSignals, SIGNAL_CODES) || !codes(raw.manipulationTechniques, MANIPULATION_CODES) || !codes(raw.recommendedActionCodes, ACTION_CODES)) throw new MetaValidationError("허용되지 않은 신호/행동 코드");
  if (!arrayStrings(raw.requestedActions, 12, 200) || !arrayStrings(raw.normalConversationEvidence, 12, 200)) throw new MetaValidationError("설명 텍스트 형식 오류");
  if (!arrayStrings(raw.evidenceUtteranceIds, 8, 60)) throw new MetaValidationError("근거 발화 목록 오류");
  if (!checkString(raw.uncertainty, 400)) throw new MetaValidationError("불확실성 필드 오류");
  if (typeof raw.emergencyFlag !== "boolean") throw new MetaValidationError("긴급 신호 형식 오류");
  const knownIds = new Set(turns.map(x => x.turnId));
  if ((raw.evidenceUtteranceIds as string[]).some(id => !knownIds.has(id))) throw new MetaValidationError("입력에 없는 근거 발화 ID");
  return raw as unknown as ModelAssessment;
}
