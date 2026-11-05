// Fictional, manually labeled *engineering smoke tests*; not a real-world benchmark.
// Node >=22 with experimental TypeScript stripping is required.
import { assessTriage } from "../src/modules/risk-triage/index.ts";

const samples = [
  // Unsafe actions or manipulative intent in synthetic contexts
  ["위험", "은행 보안팀입니다. 지금 당장 안전 계좌로 돈을 보내세요. 가족에게 말하지 마세요."],
  ["위험", "인증번호를 지금 읽어 주세요."],
  ["위험", "OTP를 지금 말해 주세요."],
  ["위험", "보안 앱을 설치하세요."],
  ["위험", "원격제어 앱을 설치하세요."],
  ["위험", "당신 가족을 죽일 겁니다."],
  ["위험", "검찰 수사관입니다. 지금 당장 조치하세요."],
  ["위험", "비밀로 하세요. 누구에게도 말하지 마세요."],
  ["위험", "네 기억이 틀렸어. 그런 말 한 적 없어."],
  ["위험", "이 계좌에 돈을 보내세요."],
  ["위험", "지금 당장 입금하세요."],
  ["위험", "금감원입니다. 금융 관련 조사가 시작됐습니다."],
  ["위험", "급하니까 나한테 돈 좀 빌려줄 수 있어?"], // missing trigger is expected failure mode
  ["위험", "기프트카드를 사서 코드를 사진으로 보내줘."], // out-of-vocabulary failure mode
  ["위험", "아무에게도 말하지 마세요."],
  ["위험", "3분 안에 완료해야 해."],
  // Harmless contexts; some deliberately contain risk-related vocabulary
  ["일반", "오늘 저녁 돈가스 먹을래?"],
  ["일반", "주말에 축구 하자."],
  ["일반", "내일 저녁에 생일 모임 있어."],
  ["일반", "택배 문 앞에 두었습니다."],
  ["일반", "운동 마치고 연락할게."],
  ["일반", "아까 영화 재밌었어."],
  ["일반", "이번 영화는 검찰 이야기야."],
  ["일반", "인증번호는 절대 알려주지 마세요."],
  ["일반", "계좌번호는 공개하지 마세요."],
  ["일반", "송금하지 마세요. 피싱에 주의하세요."],
  ["일반", "생일 파티를 비밀로 하세요."],
  ["일반", "은행 보안팀 드라마 본 적 있어?"],
  ["일반", "다음 주에 책 반납할게."],
  ["일반", "오늘은 가족에게 감사 인사하자."],
  ["일반", "비밀번호는 누구에게도 알리지 마세요."],
  ["일반", "아침에 커피 한 잔 할까요?"],
];

let tp=0, fp=0, tn=0, fn=0, callCandidates=0;
const mistakes = [];
for (const [groundTruth, utterance] of samples) {
  const res = assessTriage({turns:[{speaker:"caller",text:utterance}]});
  const expected = groundTruth === "위험";
  const predicted = res.riskBand !== "LOW";
  if (expected && predicted) tp++;
  else if (!expected && predicted) fp++;
  else if (!expected && !predicted) tn++;
  else fn++;
  if (res.shouldCallMeta) callCandidates++;
  if (predicted !== expected) mistakes.push({expected:groundTruth, predicted:res.riskBand, utterance});
}
const ratio = (a,b)=>b===0?"n/a":(100*a/b).toFixed(1)+"%";
console.log(JSON.stringify({
  notice:"32개 합성 문장에 대한 규칙 기반 연습 결과. 실사용 정확도 또는 Meta AI 성능이 아님.",
  total:samples.length,
  metaCallCandidates:callCandidates,
  riskAlertConfusion:{TP:tp,FP:fp,TN:tn,FN:fn},
  provisionalPrecision:ratio(tp,tp+fp),
  provisionalRecall:ratio(tp,tp+fn),
  mistakes,
},null,2));
