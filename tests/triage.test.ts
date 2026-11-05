import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTriage } from "../src/modules/risk-triage/index.ts";
const caller = (text: string) => assessTriage({ turns: [{ speaker: "caller", text }] });
test("친구의 일상 대화는 모델 호출을 요청하지 않음", () => {
  const r = caller("오늘 저녁에 돈가스 먹으러 갈래?");
  assert.equal(r.shouldCallMeta, false);
  assert.equal(r.riskIndex, 0);
});
test("은행 사칭과 송금 압박이 함께 등장하면 위험 지수가 증가", () => {
  const r = caller("은행 보안팀입니다. 지금 당장 안전 계좌로 돈을 보내세요. 가족에게는 말하지 마세요.");
  assert.equal(r.shouldCallMeta, true);
  assert.equal(r.riskBand, "HIGH");
  assert.ok(r.signals.some(x => x.code === "MONEY_REQUEST"));
  assert.ok(r.signals.some(x => x.code === "SECRECY"));
});
test("친절한 예방 안내는 의심 키워드가 있어도 높은 위험으로 단정하지 않음", () => {
  const r = caller("인증번호는 알려주면 안 됩니다. 송금하지 마세요.");
  assert.equal(r.shouldCallMeta, true); // weak trigger, Meta가 맥락 구분하도록 함
  assert.ok(r.riskIndex < 40);
});
test("키워드가 없어도 가상 거래 이벤트는 모델 호출 후보가 됨", () => {
  const r = assessTriage({ turns: [{ speaker: "caller", text: "그럼 진행해 주세요." }], actionEvent: "TRANSFER_PREPARED" });
  assert.equal(r.shouldCallMeta, true);
  assert.ok(r.signals.some(x => x.code === "MONEY_REQUEST"));
});
test("협박성 문구는 모델 응답 없이도 별도 긴급 경로 플래그", () => {
  const r = caller("당신 가족을 해칠 겁니다.");
  assert.equal(r.emergencyFlag, true);
  assert.equal(r.riskBand, "HIGH");
});
test("기억을 흔드는 표현은 가스라이팅 확정이 아닌 신호만 표시", () => {
  const r = caller("네 기억이 틀렸어. 내가 분명히 이야기했잖아.");
  assert.ok(r.signals.some(x => x.code === "REALITY_UNDERMINING"));
  assert.ok(r.limitations.some(x => x.includes("가스라이팅")));
});
test("사용자 말만으로 사기범의 요구가 있었다고 주장하지 않음", () => {
  const r = assessTriage({ turns: [{ speaker: "user", text: "OTP를 알려주지 않을게요." }] });
  assert.equal(r.riskIndex, 0);
});
test("반복 신호는 동일 코드에서 한 번만 점수 반영", () => {
  const r = assessTriage({ turns: [
    { speaker: "caller", text: "지금 당장 처리하세요" },
    { speaker: "caller", text: "지금 당장 처리하세요" },
  ] });
  assert.equal(r.riskIndex, 12);
});

test("직접 송금 요구 한 번은 높은 위험이고 긴급 플래그는 아니다", () => {
  const r = caller("이 계좌로 지금 송금하세요.");
  assert.equal(r.riskBand, "HIGH");
  assert.equal(r.emergencyFlag, false);
  assert.ok(r.signals.some(x => x.code === "MONEY_REQUEST"));
});
test("상품권, 카드번호, 시드 요구는 잡고 거절 안내는 높이지 않는다", () => {
  assert.equal(caller("상품권 코드를 지금 보내 주세요.").riskBand, "HIGH");
  assert.equal(caller("카드번호를 이 페이지에 입력하세요.").riskBand, "HIGH");
  assert.equal(caller("복구 시드를 순서대로 읽어 주세요.").riskBand, "HIGH");
  assert.ok(caller("카드번호를 입력하지 마세요.").riskIndex < 40);
  assert.ok(caller("상품권 코드를 보내라는 요구는 거절하세요.").riskIndex < 40);
  assert.ok(caller("복구 시드는 읽지 마세요.").riskIndex < 40);
});
test("심리적 압박 지수는 금전 위험 지수와 별도이며 반복 현실 부정만 표시", () => {
  const r = assessTriage({ turns: [
    {speaker: "caller", text: "네 기억이 틀렸어."},
    {speaker: "caller", text: "그런 말 한 적 없어."},
  ] });
  assert.equal(r.realityUnderminingObservations, 2);
  assert.equal(r.repeatedRealityUnderminingCue, true);
  assert.ok(r.psychologicalPressureIndex > r.riskIndex);
  assert.equal(r.emergencyFlag, false);
});
