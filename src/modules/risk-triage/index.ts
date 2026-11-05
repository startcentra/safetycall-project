/**
 * Offline, deterministic trigger/risk-index experiment for fictional calls.
 * This is NOT an AI judgment, a fraud probability, or a production safety control.
 * Only a server-side policy engine may make any transaction decision.
 */
export type Speaker = "caller" | "user" | "unknown" | "multiple";
export type RiskBand = "LOW" | "CAUTION" | "HIGH";
export type SignalCode =
  | "MONEY_REQUEST" | "CREDENTIAL_REQUEST" | "REMOTE_CONTROL"
  | "SECRECY" | "URGENCY" | "AUTHORITY_CLAIM"
  | "REALITY_UNDERMINING" | "DIRECT_THREAT" | "POST_TRANSFER";

/** Display labels are centralized here; interfaces must not invent a second risk vocabulary. */
export const SIGNAL_LABELS: Record<SignalCode, string> = {
  MONEY_REQUEST: "송금 요구",
  CREDENTIAL_REQUEST: "인증정보 요구",
  REMOTE_CONTROL: "원격 제어 유도",
  SECRECY: "외부 연락 차단 요구",
  URGENCY: "긴급성 압박",
  AUTHORITY_CLAIM: "기관 권위 주장",
  REALITY_UNDERMINING: "현실 인식 흔들기 단서",
  DIRECT_THREAT: "폭력·협박 표현",
  POST_TRANSFER: "송금 완료 진술",
};

export interface TriageTurn { speaker: Speaker; text: string; }
export type ActionEvent = "NONE" | "TRANSFER_PREPARED" | "OTP_SHARE_ATTEMPT";
export interface TriageInput { turns: TriageTurn[]; actionEvent?: ActionEvent; priorSignals?: TriageSignal[]; }
export interface TriageSignal { code: SignalCode; weight: number; evidence: string; turn: number; }
export interface TriageResult {
  mode: "OFFLINE_RULE_EXPERIMENT";
  shouldCallMeta: boolean;
  triggerReasons: string[];
  signals: TriageSignal[];
  riskIndex: number;
  psychologicalPressureIndex: number;
  realityUnderminingObservations: number;
  repeatedRealityUnderminingCue: boolean;
  riskBand: RiskBand;
  emergencyFlag: boolean;
  limitations: string[];
}

const RULES: Array<{ code: SignalCode; weight: number; expressions: RegExp[] }> = [
  { code: "MONEY_REQUEST", weight: 40, expressions: [
    /(?:송금|이체|입금)\s*(?:해\s?줘|해주세요|하세요|하라|해야|하시|해주시|하시면|해봐|해\s?달라)/i,
    /(?:계좌|돈|금액|자금|잔액).{0,15}(?:보내\s?줘|보내세요|보내야|옮기세요|옮겨|입금하세요|이체하세요)/i,
    /안전\s?계좌.{0,15}(?:보내|이체|옮기|입금)/i,
    /상품권\s?(?:코드|번호|핀).{0,18}(?:보내|알려|읽어|입력해|주세요|하라|하세요)/i,
    /(?:send|wire|transfer|deposit)\s+(?:(?:the|your)\s+)?(?:money|funds|payment|savings|balance|\$[0-9,]+)\s*(?:now|today|immediately|to\s+(?:a|the|this)\s+(?:protected|secure|safe)\s+account)?/i,
    /(?:you\s+(?:must|need to|have to))\s+(?:send|wire|transfer|pay)\s+(?:me|us|the money|\$[0-9,]+)/i,
    /(?:gift\s?card|voucher)\s+(?:code|pin).{0,24}(?:send|read|give|tell)/i,
  ] },
  { code: "CREDENTIAL_REQUEST", weight: 45, expressions: [
    /(?:인증\s?번호|OTP|일회용\s?비밀번호|비밀번호|보안카드).{0,20}(?:알려|말해|보내|읽어|전달|입력해)/i,
    /(?:알려|말해|보내|읽어|전달).{0,18}(?:인증\s?번호|OTP|비밀번호)/i,
    /카드\s?번호.{0,18}(?:입력|알려|말해|보내|넣어|읽)/i,
    /(?:시드|복구\s?문구|니모닉).{0,18}(?:읽어|알려|보내|말하)/i,
    /(?:tell|send|share|read|give)\s+(?:me\s+)?(?:your\s+)?(?:one.time code|verification code|otp|password|security code|card number|seed phrase|recovery phrase)/i,
    /(?:card number|seed phrase|recovery phrase).{0,30}(?:enter|read|tell|give|share)/i,
  ] },
  { code: "REMOTE_CONTROL", weight: 43, expressions: [
    /(?:원격\s?제어|화면\s?공유).{0,18}(?:앱|어플|설치|하세요|해\s?줘|켜)/i,
    /(?:보안\s?앱|보호\s?앱|어플|애플리케이션).{0,15}(?:설치하세요|설치해야|설치해\s?줘)/i,
    /(?:install|download|enable|start)\s+(?:the\s+|this\s+|a\s+)?(?:remote.access|screen.sharing|support app)/i,
    /(?:share\s+your\s+screen|give\s+(?:me|us)\s+remote\s+access)/i,
  ] },
  { code: "SECRECY", weight: 16, expressions: [
    /(?:아무에게도|누구에게도|다른\s?사람에게|가족에게).{0,18}(?:말하지|알리지|비밀)/i,
    /(?:비밀로|혼자만\s?알고).{0,12}(?:하|해|하세요|계세요)/i,
    /(?:don't|do not|never)\s+(?:tell|contact|call|notify)\s+(?:anyone|your family|the police|your bank)/i,
  ] },
  { code: "URGENCY", weight: 12, expressions: [
    /지금\s?당장|즉시\s?(?:처리|보내|입금|송금)|시간이\s?없|(?:3|5|10)분\s?안에/i,
    /(?:right\s+now|within\s+(?:five|ten|5|10)\s+minutes|no\s+time\s+to\s+wait|immediately)/i,
  ] },
  { code: "AUTHORITY_CLAIM", weight: 8, expressions: [
    /검찰|수사관|금감원|금융감독원|은행\s?(?:보안팀|수사팀)/i,
    /(?:i(?:'m| am)\s+(?:calling\s+)?from\s+(?:the\s+)?(?:bank|fbi|irs|police)|federal\s+investigator)/i,
  ] },
  { code: "REALITY_UNDERMINING", weight: 9, expressions: [
    /(?:네|너|당신)\s?(?:기억|생각)이\s?틀렸|(?:네가|당신이)\s?잘못\s?(?:들었|기억)|그런\s?말\s?한\s?적\s?없|너무\s?예민해/i,
  ] },
  { code: "DIRECT_THREAT", weight: 60, expressions: [
    /(?:가족|딸|아들|아이|너|당신).{0,22}(?:죽일|해칠|납치|죽여)/i,
    /(?:죽일|해칠|납치).{0,22}(?:가족|딸|아들|아이)/i,
    /(?:we\s+(?:have|kidnapped|took)\s+your\s+(?:son|daughter|child|grandson|granddaughter)|(?:hurt|kill)\s+your\s+(?:son|daughter|child|family))/i,
  ] },
];

const WEAK_TRIGGERS: Array<{ name: string; re: RegExp }> = [
  { name: "금융 관련 키워드", re: /송금|이체|입금|계좌|안전\s?계좌/i },
  { name: "인증정보 관련 키워드", re: /인증\s?번호|OTP|보안카드/i },
  { name: "의심스러운 앱 요청", re: /원격\s?제어|화면\s?공유/i },
  { name: "위협 관련 키워드", re: /납치|살해|죽이겠|해치겠/i },
];

const NON_DIRECT_MONEY_ADVICE = /(?:송금|이체|입금)\s?하지\s?마|(?:사칭|피싱|사기).{0,40}(?:송금|이체)하라는.{0,30}사기|(?:송금|이체)하라는.{0,30}사기|(?:돈|금액)\s?보내지\s?마|상품권.{0,40}(?:거절|하지\s?마|보내지\s?마)|(?:gift\s?card|voucher).{0,40}\b(?:refuse|do not|don't)\b|\b(?:do not|don't|never)\s+(?:send|wire|transfer)\s+(?:money|funds)\b/i;
const NON_DIRECT_CREDENTIAL_ADVICE = /(?:인증\s?번호|OTP|비밀번호).{0,22}(?:알려\s?주면\s?안|알려\s?주지\s?마|말하면\s?안|제공하면\s?안|보내지\s?마)|카드\s?번호.{0,28}(?:입력하지\s?마|넣지\s?마|알려\s?주지\s?마|주지\s?마)|(?:시드|복구\s?문구).{0,24}(?:읽지\s?마|알려\s?주지\s?마)|\b(?:do not|don't|never)\s+(?:share|give|send|enter|read)\s+(?:your\s+)?(?:code|otp|password|card|seed)/i;

export function assessTriage(input: TriageInput): TriageResult {
  // Full received history, not the last eight turns. A caller may pass checkpoint signals
  // for compact long-running sessions; the single scoring implementation remains here.
  const turns = input.turns;
  const signals: TriageSignal[] = [...(input.priorSignals ?? [])];
  const weak: string[] = [];
  for (const [offset, turn] of turns.entries()) {
    if (turn.speaker !== "caller") continue;
    const normalized = turn.text.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    // Each window overlaps to preserve indicators across boundaries. Never drop a tail.
    for (let position=0;position<normalized.length;position+=650) {
      const phrase=normalized.slice(position,position+800);
      if (!phrase)continue;
      for (const rule of RULES) {
        if (rule.code === "MONEY_REQUEST" && NON_DIRECT_MONEY_ADVICE.test(phrase) &&
          !/(?:대신|하지만|그런데|그러니|그러나).{0,60}(?:송금|이체|입금)\s*(?:하세요|해주세요|해\s?주세요|해야|하라)/.test(phrase)) continue;
        if (rule.code === "CREDENTIAL_REQUEST" && NON_DIRECT_CREDENTIAL_ADVICE.test(phrase)) continue;
        const matched = rule.expressions.map(re=>re.exec(phrase)).find(Boolean);
        if (matched) {
          // Evidence must include the triggering words, even in a very long utterance.
          const start=Math.max(0,matched.index-35);
          signals.push({code:rule.code,weight:rule.weight,evidence:phrase.slice(start,Math.min(phrase.length,matched.index+matched[0].length+45)),turn:offset});
        }
      }
      for(const key of WEAK_TRIGGERS)if(key.re.test(phrase))weak.push(key.name);
    }
  }
  const action = input.actionEvent ?? "NONE";
  if (action === "TRANSFER_PREPARED") signals.push({ code: "MONEY_REQUEST", weight: 32, evidence: "가상 송금 준비 이벤트", turn: -1 });
  if (action === "OTP_SHARE_ATTEMPT") signals.push({ code: "CREDENTIAL_REQUEST", weight: 45, evidence: "가상 인증정보 제공 시도 이벤트", turn: -1 });
  if (input.turns.some(t => t.speaker === "user" && /(?:이미\s?)?(?:송금했|이체했|돈\s?보냈)|\b(?:i\s+(?:already\s+)?(?:sent|wired|transferred|paid)\s+(?:the\s+)?(?:money|funds)|i\s+paid\s+them)\b/i.test(t.text))) {
    signals.push({ code: "POST_TRANSFER", weight: 42, evidence: "사용자가 이미 보냈다고 언급함(진위 미확인)", turn: -1 });
  }
  const byCode = new Map<SignalCode, TriageSignal>();
  for (const signal of signals) if (!byCode.has(signal.code)) byCode.set(signal.code, signal);
  const unique = [...byCode.values()];
  const riskIndex = Math.min(100, unique.reduce((sum, s) => sum + s.weight, 0));
  const pressureWeights: Partial<Record<SignalCode, number>> = {
    SECRECY: 23, URGENCY: 16, AUTHORITY_CLAIM: 12,
    REALITY_UNDERMINING: 28, DIRECT_THREAT: 45,
  };
  const realityUnderminingObservations = new Set(signals
    .filter(s => s.code === "REALITY_UNDERMINING" && s.turn >= 0).map(s => s.turn)).size;
  const repeatedRealityUnderminingCue = realityUnderminingObservations >= 2;
  const psychologicalPressureIndex = Math.min(100,
    unique.reduce((sum, s) => sum + (pressureWeights[s.code] ?? 0), 0)
      + (repeatedRealityUnderminingCue ? 20 : 0));
  const emergencyFlag = unique.some(s => s.code === "DIRECT_THREAT");
  const riskBand: RiskBand = riskIndex >= 40 ? "HIGH" : riskIndex >= 15 ? "CAUTION" : "LOW";
  const triggerReasons = [...new Set([...weak, ...unique.map(s => s.code)])];
  return {
    mode: "OFFLINE_RULE_EXPERIMENT",
    shouldCallMeta: triggerReasons.length > 0,
    triggerReasons, signals: unique, riskIndex, psychologicalPressureIndex,
    realityUnderminingObservations, repeatedRealityUnderminingCue, riskBand, emergencyFlag,
    limitations: [
      ...(input.turns.some(t=>t.speaker === "unknown" || t.speaker === "multiple") ? ["화자 확인이 불가능한 발화가 포함되어 있으며, 해당 발화만으로 상대방의 요구를 확정하지 않습니다."] : []),
      "위험 지수는 임시 가중치의 합계이며 사기 확률이 아닙니다.",
      "가스라이팅 또는 범죄자 여부를 판정하지 않습니다. 표현상의 심리 조작 단서만 표시합니다.",
      "이 결과는 Meta 모델의 분석이 아니며 실제 통화·금융거래를 제어하지 않습니다.",
    ],
  };
}
