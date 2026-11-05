/**
 * Second Muse Spark accuracy run. New synthetic scenarios only.
 * Budget is the local Spark estimate for THIS run, not a Meta invoice.
 * Rules engine and SafeBank holds are not modified.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LiveMetaProvider } from '../src/modules/analysis/meta-provider.ts';
import { estimateSparkUsd } from '../src/modules/cost/guard.ts';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'meta-budget', 'round2');
const JSONL = path.join(OUT, 'calls.jsonl');
const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const DRY = process.argv.includes('--dry-run');
const REDECIDE = process.argv.includes('--redecide');
const BUDGET = Number(arg('budget', '43'));
const CONCURRENCY = Number(arg('concurrency', '4'));
const PHASE = arg('phase', 'all');
if (!Number.isFinite(BUDGET) || BUDGET <= 0 || BUDGET > 43) throw new Error('BUDGET_OUT_OF_RANGE');
if (!Number.isSafeInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 4) throw new Error('CONCURRENCY_OUT_OF_RANGE');
if (!['dev', 'rest', 'all'].includes(PHASE)) throw new Error('PHASE');

const ADDENDUM = [
  '추가 보정:',
  '권위 사칭, 비밀로 하라, 오늘 안의 불이익, 수익 보장, 공식 채널을 쓰지 말라는 말 중 둘이 겹치고, 아직 송금·인증·카드·원격·개인정보 요구가 없으면 riskLevel은 CAUTION이다.',
  '그 경우 LOW로 내리지 마라. HIGH로 올리지도 마라.',
  '일상 약속, 진료 예약, 배송 완료 안내, 예방 교육에서 사기 문장을 인용만 한 경우, 공식 번호로 직접 끊고 확인하라는 안내는 LOW다.',
  '직접 요구가 있으면 기존 규칙대로 HIGH다.',
  'SIMULATED_GPS만으로 단계를 올리지 마라.',
].join('\n');
const EN_NOTE = '발화는 영어일 수 있다. 같은 기준으로 판단한다.';
const ASK = /이체|입금|송금|카드번호|인증번호|비밀번호|원격|화면 공유|주민등록|상품권|몸값|시드|gift card|one-time code|transfer|password|remote screen|card number|wire the|pay the fee|deposit the/i;

const times = ['여섯 시', '일곱 시', '여덟 시', '내일 아침', '목요일 네 시', '금요일 열한 시', '주말 오후', '모레 점심'];
const places = ['역 앞', '회사 앞', '공원', '도서관', '시장', '카페', '학교 앞', '동네 식당'];
const foods = ['김치찌개', '비빔밥', '국수', '샐러드', '김밥', '초밥', '된장찌개', '칼국수'];

function turnsOf(lines, speaker = 'caller') {
  return lines.map((text, index) => ({ turnId: `t${index + 1}`, speaker, text }));
}
function tag(index) { return `사례 ${10000 + (index % 80000)}`; }

const explicitFamilies = [
  (i) => [`사진이 확보됐다는 ${tag(i)} 연락입니다.`, '가족에게 공개하겠다고 합니다.', '막아 달라며 상품권 코드를 지금 보내 달라고 합니다.'],
  (i) => [`가족이 붙잡혀 있다는 ${tag(i)} 전화입니다.`, '경찰에는 비밀로 하라 합니다.', '몸값을 지정 계좌로 송금하라 합니다.'],
  (i) => [`손주라며 번호가 바뀌었다는 ${tag(i)} 입니다.`, '문제가 생겼다고 합니다.', '새 계좌로 지금 이체해 달라고 합니다.'],
  (i) => [`전기가 끊긴다는 ${tag(i)} 독촉입니다.`, '오늘 밤이 마감이라고 합니다.', '미납금을 가상계좌로 이체하라 합니다.'],
  (i) => [`주정차 과태료 ${tag(i)} 라고 합니다.`, '문자로 온 QR을 찍으라 합니다.', '페이지에 카드번호를 입력하라 합니다.'],
  (i) => [`학교 행정실 ${tag(i)} 를 사칭합니다.`, '등록금 계좌가 바뀌었다고 합니다.', '오늘 새 계좌로 송금하라 합니다.'],
  (i) => [`집주인 대리 ${tag(i)} 라고 합니다.`, '보증금 계좌가 변경됐다고 합니다.', '오늘 중으로 입금하라 합니다.'],
  (i) => [`거래소 보안 ${tag(i)} 를 사칭합니다.`, '출금이 잠겼다고 합니다.', '해제 수수료를 먼저 입금하라 합니다.'],
  (i) => [`해외 통관 ${tag(i)} 안내라고 합니다.`, '오늘 안에 처리하라 합니다.', '관세를 카드번호로 결제하라 합니다.'],
  (i) => [`연금 이상 ${tag(i)} 조사라고 합니다.`, '가족에게 말하지 말라 합니다.', '인증번호를 읽어 달라 합니다.'],
  (i) => [`통신 해킹 ${tag(i)} 점검이라고 합니다.`, '지금 끊지 말라 합니다.', '원격 제어 앱을 설치하라 합니다.'],
  (i) => [`병원 수납 ${tag(i)} 독촉이라고 합니다.`, '미납이 신용에 남는다 합니다.', '인터넷 뱅킹 비밀번호를 알려 달라 합니다.'],
  (i) => [`채용 확정 ${tag(i)} 문자라고 합니다.`, '출근 전에 장비 준비가 필요하다 합니다.', '장비비를 오늘 입금하라 합니다.'],
  (i) => [`Tax office case ${tag(i)}.`, 'They say a penalty starts today.', 'Read the one-time code on your phone.'],
  (i) => [`Software support case ${tag(i)}.`, 'They say a refund is waiting.', 'Install remote screen sharing and stay on the line.'],
  (i) => [`Shopping account case ${tag(i)}.`, 'They say the account will close today.', 'Transfer the balance to a safe wallet now.'],
];
const softFamilies = [
  (i) => [`수사 협조 ${tag(i)} 전화입니다.`, '오늘 안에 불이익이 있다고 합니다.', '가족에게는 비밀로 하라 합니다.', '구체적인 다음 절차는 나중에 안내한다고 합니다.'],
  (i) => [`수익이 보장된다는 ${tag(i)} 소개입니다.`, '오늘만 자리가 있다고 합니다.', '다른 사람에게는 알리지 말라 합니다.', '금액 안내는 다음 통화라고 합니다.'],
  (i) => [`배송 보류 ${tag(i)} 라고만 합니다.`, '판매자에게 연락하지 말라 합니다.', '오늘 중 확인이 필요하다고 합니다.', '아직 주소 확인 전이라고 합니다.'],
  (i) => [`손주라며 ${tag(i)} 로 안부를 묻습니다.`, '번호가 바뀌었다고 합니다.', '부모에게는 아직 비밀이라 합니다.', '부탁은 다음에 말하겠다고 합니다.'],
  (i) => [`Confidential review ${tag(i)}.`, 'Do not call your bank yet.', 'They say the account is at risk today.', 'The next step will be explained later.'],
  (i) => [`투자 모임 ${tag(i)} 에 초대합니다.`, '최근 성과가 좋았다고 합니다.', '공식 앱은 쓰지 말라 합니다.', '오늘은 설명만 한다고 합니다.'],
];
const normalFamilies = [
  (i) => [`오늘 ${times[i % times.length]}에 ${foods[i % foods.length]} 먹을래요?`, `${places[i % places.length]}에서 봅시다.`, `${tag(i)} 약속입니다. 비용 안내는 없습니다.`],
  (i) => [`검진 ${tag(i)} 는 ${times[i % times.length]} 입니다.`, '준비물은 신분증입니다.', '수납은 창구에서 합니다.'],
  (i) => [`택배 ${tag(i)} 는 문 앞에 두었습니다.`, '추가 요금은 없습니다.', '조회는 공식 앱에서 하세요.'],
  (i) => [`면접 ${tag(i)} 는 ${times[i % times.length]} 온라인입니다.`, '참가비는 없습니다.', '링크는 회사 메일로만 갑니다.'],
  (i) => ['은행은 전화로 비밀을 묻지 않습니다.', '의심되면 끊으세요.', '플라스틱 뒷면에 인쇄된 고객센터로 직접 거세요.'],
  (i) => [`환급 ${tag(i)} 는 홈택스에 본인이 로그인하면 됩니다.`, '이 전화는 어떤 번호도 받지 않습니다.', '창구 방문도 가능합니다.'],
  (i) => [`Package ${tag(i)} was left at the door.`, 'No extra charge is due.', 'Track it only in the official app.'],
  (i) => [`동네 반상회 ${tag(i)} 공지입니다.`, '일요일 오후에 모입니다.', '회비는 지난달에 이미 걷었습니다.'],
];
const eduFamilies = [
  (i) => [`예방 교육 ${tag(i)} 입니다.`, '사례에서는 "인증번호를 읽어 달라"고 말했습니다.', '그 요구는 거절하고 공식 번호로 직접 확인하세요.'],
  (i) => [`News briefing ${tag(i)}.`, 'The quoted scam said "wire the savings to a safe account."', 'The lesson is to refuse and hang up.'],
];
const ambigFamilies = [
  (i) => [`${tag(i)} 편지가 왔다는 말만 들었습니다.`, '무엇을 하라는 안내는 없었습니다.'],
  (i) => [`${tag(i)} 오늘 당장 내려오라 합니다.`, '이유는 말하지 않았습니다.'],
];
const probeOnly = [
  (i) => [`교도소 면회 ${tag(i)} 예약이라 합니다.`, '오늘 아니면 못 만난다고 합니다.', '면회비를 상품권으로 보내 달라 합니다.'],
  (i) => [`중고 거래 ${tag(i)} 안전결제라 합니다.`, '판매자를 믿지 말라 합니다.', '먼저 수수료를 입금해야 배송된다고 합니다.'],
  (i) => [`재택 알바 ${tag(i)} 합격이라 합니다.`, '오늘 교육을 시작해야 한다 합니다.', '교재비를 먼저 입금하라 합니다.'],
  (i) => [`재난 기부 ${tag(i)} 가 급하다고 합니다.`, '공식 단체 말고 이 계좌라 합니다.', '지금 송금해 달라 합니다.'],
  (i) => [`연애 ${tag(i)} 주차 대화 끝에 말합니다.`, '같이 투자하자고 합니다.', '수익금을 보려면 출금 수수료를 입금하라 합니다.'],
  (i) => [`보관료 ${tag(i)} 가 쌓였다고 합니다.`, '오늘 폐기된다고 합니다.', '카드번호로 보관료를 내라 합니다.'],
  (i) => [`교통 과태료 ${tag(i)} 라고 합니다.`, '면허가 정지된다고 합니다.', '가상계좌로 이체하라 합니다.'],
  (i) => [`보험 환급 ${tag(i)} 가 대기 중이라 합니다.`, '창구는 가지 말라 합니다.', '본인 인증 비밀번호를 알려 달라 합니다.'],
  (i) => [`학자금 ${tag(i)} 승인라 합니다.`, '보증인이 필요 없다 합니다.', '선취 수수료를 입금하라 합니다.'],
  (i) => [`항공권 환불 ${tag(i)} 이라 합니다.`, '좌석이 곧 사라진다고 합니다.', '원격 화면으로 환불을 처리하자 합니다.'],
  (i) => [`Wallet recovery ${tag(i)}.`, 'They say the wallet locks today.', 'Read the seed phrase and the one-time code.'],
  (i) => [`Church collection ${tag(i)} was moved.`, 'They say the usual box is closed.', 'Wire the offering to a new account today.'],
];

function familyCall(list, index) { return list[index % list.length](index); }
function easy(kind, index) {
  if (kind === 'explicit') return turnsOf(familyCall(explicitFamilies, index));
  if (kind === 'soft') return turnsOf(familyCall(softFamilies, index));
  if (kind === 'normal') return turnsOf(familyCall(normalFamilies, index));
  if (kind === 'edu') return turnsOf(familyCall(eduFamilies, index));
  if (kind === 'probe') return turnsOf(familyCall(probeOnly, index));
  return turnsOf(familyCall(ambigFamilies, index));
}
function isEnglish(lines) { return lines.some(line => /[A-Za-z]{4}/.test(line)); }

const hard = [
  { id: 'r2_sextortion', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['사진을 가지고 있다고 합니다.', '가족 단톡에 올리겠다고 합니다.', '막으려면 상품권 코드를 지금 보내 달라 합니다.'] },
  { id: 'r2_ransom', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['아들이 여기 있다고 합니다.', '경찰에 말하면 위험하다고 합니다.', '몸값을 지정 계좌로 송금하라 합니다.'] },
  { id: 'r2_utility', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['한전 고객센터라고 합니다.', '오늘 밤 전기가 끊긴다고 합니다.', '미납액을 이 계좌로 이체하라 합니다.'] },
  { id: 'r2_school', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['학교 행정실이라고 합니다.', '등록금 계좌가 오늘 바뀌었다고 합니다.', '새 계좌로 송금하라 합니다.'] },
  { id: 'r2_landlord', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['집주인 동생이라고 합니다.', '보증금 계좌를 바꿨다고 합니다.', '오늘 입금하지 않으면 계약이 취소된다고 합니다.'] },
  { id: 'r2_exchange', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['거래소 보안팀이라고 합니다.', '출금이 잠겼다고 합니다.', '해제하려면 수수료를 먼저 입금하라 합니다.'] },
  { id: 'r2_irs', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['This is the tax enforcement desk.', 'A warrant is prepared for today.', 'Read the one-time code to stop it.'] },
  { id: 'r2_remote_en', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['Support will refund the duplicate charge.', 'Download the remote tool.', 'Turn on remote screen sharing now.'] },
  { id: 'r2_soft_invest', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['수익이 보장되는 방이라고 합니다.', '오늘만 열린다고 합니다.', '가족에게는 비밀로 하라 합니다.', '금액은 다음 통화에서 말하겠다고 합니다.'] },
  { id: 'r2_soft_police', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['사이버 수사팀이라고 합니다.', '오늘 중 불이익이 있다고 합니다.', '다른 기관에는 연락하지 말라 합니다.', '요청 내용은 잠시 뒤 안내한다고 합니다.'] },
  { id: 'r2_soft_parcel', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['배송이 보류됐다고만 합니다.', '판매자에게 묻지 말라 합니다.', '오늘 안에 확인하지 않으면 반송된다고 합니다.', '아직 링크는 없다고 합니다.'] },
  { id: 'r2_soft_en', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['This is a confidential fraud review.', 'Do not contact your bank yet.', 'They say inaction today will freeze the account.', 'No payment instruction has been given.'] },
  { id: 'r2_edu', split: 'dev', kind: 'edu', gold: 'LOW', lines: ['수업 시간입니다.', '범인이 인증번호를 읽으라고 한 사례를 읽습니다.', '여러분은 그 요구를 거절하면 됩니다.'] },
  { id: 'r2_story', split: 'dev', kind: 'story', gold: 'LOW', lines: ['친구가 상품권 코드를 보냈다가 당했대.', '나는 아무것도 안 보냈어.', '너는 공식 앱만 쓰자.'] },
  { id: 'r2_hangup', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['의심스러운 전화는 끊는 것이 맞습니다.', '비밀을 묻는 곳은 기관이 아닙니다.', '인쇄된 고객센터로 직접 거세요.'] },
  { id: 'r2_clinic', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['내일 피검사가 있습니다.', '금식만 하면 됩니다.', '수납은 병원 창구에서 합니다.'] },
  { id: 'r2_delivered', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['택배 기사입니다.', '부재중이라 경비실에 맡겼습니다.', '추가 요금은 없습니다.'] },
  { id: 'r2_hometax', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['환급 조회는 홈택스에서 본인이 하면 됩니다.', '전화로 비밀을 묻지 않습니다.', '이 통화는 여기서 끝입니다.'] },
  { id: 'r2_dinner_bank', split: 'dev', kind: 'location', gold: 'LOW', location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' }, lines: ['저녁 뭐 먹을까?', '은행 앞을 지나가는 중이야.', '밥 먹고 집에 가자.'] },
  { id: 'r2_transfer_bank', split: 'dev', kind: 'location', gold: 'HIGH', location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' }, lines: ['창구 앞에 계시죠.', '직원에게는 개인 일이라고 하세요.', '안전 계좌로 지금 이체하세요.'] },
  { id: 'r2_edu_bank', split: 'dev', kind: 'location', gold: 'LOW', location: { source: 'SIMULATED_GPS', zone: 'NEAR_BANK', distanceBand: 'NEAR' }, lines: ['은행 앞 예방 교육입니다.', '직원이라고 해도 비밀번호는 주지 마세요.', '의심되면 끊고 공식 번호로 거세요.'] },
  { id: 'r2_pig', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['어제 이야기 즐거웠어요.', '제가 아는 투자 방이 있어요.', '요즘 수익이 좋았다고 해요.', '다른 분께는 비밀로 해 주세요.', '오늘은 방법만 말씀드릴게요.', '출금하려면 수수료를 먼저 입금해야 한답니다.'] },
  { id: 'h_parking', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['주정차 단속 알림이라고 합니다.', '오늘 내면 감경된다고 합니다.', '문자 QR에 카드번호를 넣으라 합니다.'] },
  { id: 'h_hospital', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['병원 수납팀이라고 합니다.', '미납 진료비가 있다고 합니다.', '비밀번호를 알려 주면 대신 납부한다고 합니다.'] },
  { id: 'h_recruit', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['최종 합격 통보라고 합니다.', '노트북 보증금이 필요하다고 합니다.', '오늘 보증금을 입금하라 합니다.'] },
  { id: 'h_amazon', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['Your shopping account is under review.', 'They say a hold expires today.', 'Transfer the pending refund to their wallet.'] },
  { id: 'h_grandchild', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['할머니, 나 폰 새로 샀어.', '친구 보증 때문에 급해.', '이 계좌로 용돈을 이체해 줘.'] },
  { id: 'h_carrier', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['통신사 해킹 점검이라고 합니다.', '요금이 빠져나간다고 합니다.', '원격 제어로 막아 주겠다고 합니다.'] },
  { id: 'h_seed', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['지갑 복구팀이라고 합니다.', '오늘 잠긴다고 합니다.', '복구 시드를 순서대로 읽어 달라 합니다.'] },
  { id: 'h_charity', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['재난 모금이라고 합니다.', '공식 페이지는 마감됐다고 합니다.', '개인 계좌로 지금 송금하라 합니다.'] },
  { id: 'h_soft_romance', split: 'heldout', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['오랜만에 연락했다고 합니다.', '같이 보면 좋은 투자 방이 있다고 합니다.', '다른 친구에게는 비밀이라 합니다.', '돈 이야기는 다음이라 합니다.'] },
  { id: 'h_soft_court', split: 'heldout', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['법원 서류팀이라고 합니다.', '오늘 중으로 연락이 필요하다고 합니다.', '가족에게는 알리지 말라 합니다.', '제출 방법은 곧 안내한다고 합니다.'] },
  { id: 'h_soft_en', split: 'heldout', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['A confidential benefits review is open.', 'Do not discuss it with family.', 'They say delay today causes a penalty.', 'No payment or code has been requested.'] },
  { id: 'h_story', split: 'heldout', kind: 'story', gold: 'LOW', lines: ['뉴스에서 몸값 전화를 보도하더라.', '나는 그냥 끊었고 돈은 안 보냈어.', '너도 이상한 번호는 받지 마.'] },
  { id: 'h_potluck', split: 'heldout', kind: 'normal', gold: 'LOW', lines: ['일요일 동네 식사입니다.', '김밥은 내가 준비합니다.', '장소는 경로당입니다.'] },
  { id: 'h_app_only', split: 'heldout', kind: 'normal', gold: 'LOW', lines: ['배송 조회는 공식 앱에서 하세요.', '이 전화는 요금을 말하지 않습니다.', '분실이면 앱에서 접수하세요.'] },
  { id: 'h_edu', split: 'heldout', kind: 'edu', gold: 'LOW', lines: ['사기 예방 수업입니다.', '안전 계좌로 옮기라는 대사를 인용합니다.', '그 이체 요구는 거절하는 것이 수업 내용입니다.'] },
  { id: 'h_pig', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['주말에 영화 이야기 좋았어요.', '제가 보는 코인 방이 있어요.', '요즘 분위기가 좋았다고 해요.', '회사 사람에겐 말하지 마세요.', '오늘은 참여 방법만 들을게요.', '빼려면 보증금을 먼저 입금해야 한답니다.'] },
];

function pushEasy(list, prompt, split, kind, gold, count, offset) {
  for (let i = 0; i < count; i++) {
    const index = offset + i;
    const lines = kind === 'explicit' ? familyCall(explicitFamilies, index) : kind === 'soft' ? familyCall(softFamilies, index) : kind === 'normal' ? familyCall(normalFamilies, index) : kind === 'edu' ? familyCall(eduFamilies, index) : familyCall(ambigFamilies, index);
    const id = `${split}_${kind}_${index}`;
    list.push({ key: `${prompt}:${id}`, id, prompt, split, kind, gold, lang: isEnglish(lines) ? 'en' : 'ko', turns: turnsOf(lines) });
  }
}
function pushHard(list, prompt, item) {
  list.push({ key: `${prompt}:${item.id}`, id: item.id, prompt, split: item.split, kind: item.kind, gold: item.gold, lang: isEnglish(item.lines) ? 'en' : 'ko', location: item.location, turns: turnsOf(item.lines) });
}
function addPrefixes(jobs) {
  const extra = [];
  for (const job of jobs) {
    if (!['explicit', 'soft'].includes(job.kind) || job.turns.length < 3) continue;
    if (Number(job.id.replace(/\D/g, '')) % 5 !== 0) continue;
    const id = `${job.id}_p2`;
    extra.push({ ...job, key: `${job.prompt}:${id}`, id, kind: 'prefix', gold: 'OPEN', parentId: job.id, prefixLen: 2, turns: job.turns.slice(0, 2).map((turn, index) => ({ ...turn, turnId: `t${index + 1}` })) });
  }
  return extra;
}
function devJobs(prompt) {
  const jobs = [];
  for (const item of hard) if (item.split === 'dev') pushHard(jobs, prompt, item);
  pushEasy(jobs, prompt, 'dev', 'explicit', 'HIGH', 160, 0);
  pushEasy(jobs, prompt, 'dev', 'soft', 'AT_LEAST_CAUTION', 120, 0);
  pushEasy(jobs, prompt, 'dev', 'normal', 'LOW', 100, 0);
  pushEasy(jobs, prompt, 'dev', 'edu', 'LOW', 40, 0);
  pushEasy(jobs, prompt, 'dev', 'ambig', 'AMBIG', 20, 0);
  return [...jobs, ...addPrefixes(jobs)];
}
function heldJobs(prompt) {
  const jobs = [];
  for (const item of hard) if (item.split === 'heldout') pushHard(jobs, prompt, item);
  pushEasy(jobs, prompt, 'heldout', 'explicit', 'HIGH', 48, 50000);
  pushEasy(jobs, prompt, 'heldout', 'soft', 'AT_LEAST_CAUTION', 36, 50000);
  pushEasy(jobs, prompt, 'heldout', 'normal', 'LOW', 32, 50000);
  pushEasy(jobs, prompt, 'heldout', 'edu', 'LOW', 16, 50000);
  pushEasy(jobs, prompt, 'heldout', 'ambig', 'AMBIG', 8, 50000);
  return jobs;
}
function probeJobs(prompt, count) {
  const jobs = [];
  const cycle = [['probe', 'HIGH'], ['probe', 'HIGH'], ['probe', 'HIGH'], ['probe', 'HIGH'], ['soft', 'AT_LEAST_CAUTION'], ['soft', 'AT_LEAST_CAUTION'], ['normal', 'LOW'], ['normal', 'LOW'], ['edu', 'LOW'], ['ambig', 'AMBIG']];
  for (let i = 0; i < count; i++) {
    const [kind, gold] = cycle[i % cycle.length];
    const index = 100000 + i;
    const lines = kind === 'probe' ? familyCall(probeOnly, index) : easy(kind, index).map(turn => turn.text);
    const id = `probe_${kind}_${index}`;
    jobs.push({ key: `${prompt}:${id}`, id, prompt, split: 'probe', kind: kind === 'probe' ? 'explicit' : kind, gold, lang: isEnglish(lines) ? 'en' : 'ko', turns: turnsOf(lines) });
  }
  return jobs;
}
function assertJobs(jobs) {
  for (const job of jobs) {
    if (job.kind === 'prefix') continue;
    const text = job.turns.map(turn => turn.text).join('\n');
    const asked = ASK.test(text);
    if ((job.gold === 'HIGH' || job.kind === 'explicit') && !asked) throw new Error(`EXPLICIT_WITHOUT_ASK ${job.id}`);
    if (['soft', 'normal', 'ambig'].includes(job.kind) && asked) throw new Error(`NONASK_HAS_ASK ${job.id}`);
  }
}

function detected(level) { return level === 'HIGH' || level === 'CAUTION'; }
function hit(row) {
  if (!row.ok) return false;
  if (row.gold === 'HIGH') return row.riskLevel === 'HIGH';
  if (row.gold === 'LOW') return row.riskLevel === 'LOW';
  if (row.gold === 'AT_LEAST_CAUTION') return detected(row.riskLevel);
  return false;
}
function latestOf(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.key, row);
  return [...map.values()];
}
function ratio(rows, pred, good) {
  const scored = rows.filter(row => row.ok && pred(row));
  if (!scored.length) return null;
  return scored.filter(good).length / scored.length;
}
function pack(rows, prompt, split) {
  const all = latestOf(rows).filter(row => (row.prompt === prompt || row.prompt === `${prompt}-en`) && row.split === split);
  const main = all.filter(row => row.kind !== 'prefix');
  const explicit = main.filter(row => row.gold === 'HIGH');
  const normal = main.filter(row => row.gold === 'LOW' && ['normal', 'edu', 'story'].includes(row.kind));
  const edu = main.filter(row => row.kind === 'edu');
  const soft = main.filter(row => row.kind === 'soft');
  const locationLow = main.filter(row => row.kind === 'location' && row.gold === 'LOW');
  return {
    explicitHighRate: ratio(explicit, () => true, row => row.riskLevel === 'HIGH'),
    normalLowRate: ratio(normal, () => true, row => row.riskLevel === 'LOW'),
    eduLowRate: ratio(edu, () => true, row => row.riskLevel === 'LOW'),
    softDetectRate: ratio(soft, () => true, row => detected(row.riskLevel)),
    softHighRate: ratio(soft, () => true, row => row.riskLevel === 'HIGH'),
    locationLowMisses: locationLow.filter(row => row.ok && row.riskLevel !== 'LOW').length,
    fraudRecall: ratio(main, row => row.gold === 'HIGH' || row.gold === 'AT_LEAST_CAUTION', row => row.gold === 'HIGH' ? row.riskLevel === 'HIGH' : detected(row.riskLevel)),
    n: main.filter(row => row.ok).length,
  };
}
function choose(a, b) {
  if (!a || !b || a.explicitHighRate === null || b.softDetectRate === null) return { winner: 'A', reason: 'INCOMPLETE' };
  const ok = [
    b.explicitHighRate + 0.005 >= a.explicitHighRate,
    b.normalLowRate !== null && a.normalLowRate !== null && b.normalLowRate + 1e-9 >= a.normalLowRate,
    b.eduLowRate !== null && a.eduLowRate !== null && b.eduLowRate + 1e-9 >= a.eduLowRate,
    b.locationLowMisses <= a.locationLowMisses,
    a.softHighRate === null || b.softHighRate === null || b.softHighRate <= a.softHighRate + 0.08,
    b.fraudRecall !== null && a.fraudRecall !== null && b.fraudRecall + 1e-9 >= a.fraudRecall,
  ];
  if (ok.some(item => !item)) return { winner: 'A', reason: 'CONSTRAINT' };
  if (b.softDetectRate >= a.softDetectRate + 0.05) return { winner: 'C', reason: 'SOFT_DETECT' };
  return { winner: 'A', reason: 'NO_GAIN' };
}

let spent = 0;
let reserved = 0;
const RESERVE = 0.06;
const done = new Set();
const memory = [];
let writeChain = Promise.resolve();
function takeSlot() {
  if (spent + reserved + RESERVE > BUDGET) return false;
  reserved += RESERVE;
  return true;
}
function commit(usd) { reserved -= RESERVE; spent += usd; }
function remember(row) {
  memory.push(row);
  writeChain = writeChain.then(() => appendFile(JSONL, `${JSON.stringify(row)}\n`));
  return writeChain;
}
async function execute(job, provider) {
  let liability = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await provider.analyze({ input: { turns: job.turns, actionEvent: 'NONE', ...(job.location ? { locationObservation: job.location } : {}) }, triage: { signals: [] } });
      const inputTokens = result.usage.inputTokens;
      const outputTokens = result.usage.outputTokens;
      const usd = (inputTokens === null || outputTokens === null ? 0.05 : estimateSparkUsd(inputTokens, outputTokens)) + liability;
      return { key: job.key, id: job.id, prompt: job.prompt, split: job.split, kind: job.kind, gold: job.gold, parentId: job.parentId ?? null, prefixLen: job.prefixLen ?? null, ok: true, riskLevel: result.analysis.riskLevel, inputTokens, outputTokens, usd, error: null };
    } catch (error) {
      const name = error.kind || error.name || 'ERROR';
      if (['RATE_LIMIT', 'TIMEOUT', 'UPSTREAM', 'INVALID_RESPONSE'].includes(name) && attempt === 1) {
        liability += 0.02;
        await new Promise(resolve => setTimeout(resolve, name === 'RATE_LIMIT' ? 3000 : 700));
        continue;
      }
      return { key: job.key, id: job.id, prompt: job.prompt, split: job.split, kind: job.kind, gold: job.gold, parentId: job.parentId ?? null, prefixLen: job.prefixLen ?? null, ok: false, riskLevel: null, inputTokens: 0, outputTokens: 0, usd: liability + 0.02, error: name };
    }
  }
  throw new Error('UNREACHABLE');
}
async function runQueue(jobs, providers) {
  let cursor = 0;
  let finished = 0;
  async function worker() {
    for (;;) {
      if (!takeSlot()) return;
      while (cursor < jobs.length && done.has(jobs[cursor].key)) cursor += 1;
      if (cursor >= jobs.length) { reserved -= RESERVE; return; }
      const job = jobs[cursor++];
      const provider = providers[job.lang === 'en' ? `${job.prompt}-en` : job.prompt];
      const row = await execute(job, provider);
      commit(row.usd);
      done.add(row.key);
      await remember(row);
      finished += 1;
      console.log(`${row.prompt} ${row.id} ${row.gold} -> ${row.ok ? row.riskLevel : row.error} usd=${row.usd.toFixed(5)} total=${spent.toFixed(4)}`);
      if (finished % 25 === 0) await writeFile(path.join(OUT, 'progress.json'), JSON.stringify({ spent, finished, calls: memory.length }));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await writeChain;
}
async function seed() {
  let raw = '';
  try { raw = await readFile(JSONL, 'utf8'); } catch { raw = ''; }
  for (const line of raw.split(/\n+/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    memory.push(row);
    spent += row.usd;
    if (row.ok) done.add(row.key);
  }
}
function makeProviders(apiKey) {
  const base = { apiKey, timeoutMs: 30000, sourceContext: 'SYNTHETIC_SCRIPTED_TEXT' };
  const map = {
    A: new LiveMetaProvider(base),
    C: new LiveMetaProvider({ ...base, instructionAddendum: ADDENDUM }),
  };
  map['A-en'] = new LiveMetaProvider({ ...base, instructionAddendum: EN_NOTE });
  map['C-en'] = new LiveMetaProvider({ ...base, instructionAddendum: `${ADDENDUM}\n${EN_NOTE}` });
  return map;
}
function coverage(jobs, prompt) {
  const keys = jobs.filter(job => job.prompt === prompt && job.split === 'dev');
  const latest = latestOf(memory);
  const ok = keys.filter(job => latest.some(row => row.key === job.key && row.ok)).length;
  return { expected: keys.length, ok, okRate: keys.length ? ok / keys.length : 0 };
}

if (ADDENDUM.length > 700 || `${ADDENDUM}\n${EN_NOTE}`.length > 800) throw new Error('ADDENDUM_TOO_LONG');
const dev = [...devJobs('A'), ...devJobs('C')];
const seen = new Set();
const uniqueDev = [];
for (const job of dev) if (!seen.has(job.key)) { seen.add(job.key); uniqueDev.push(job); }
assertJobs(uniqueDev);
const sampleHold = heldJobs('A');
const sampleProbe = probeJobs('A', 30);
assertJobs(sampleHold);
assertJobs(sampleProbe);
if (DRY) {
  const by = {};
  for (const job of uniqueDev) by[`${job.prompt}:${job.kind}`] = (by[`${job.prompt}:${job.kind}`] ?? 0) + 1;
  console.log(JSON.stringify({ dryRun: true, dev: uniqueDev.length, heldPreview: sampleHold.length, addendumChars: ADDENDUM.length, by }, null, 2));
  process.exit(0);
}

const key = process.env.MODEL_API_KEY ?? '';
if (key.trim().length < 12) throw new Error('MODEL_API_KEY_MISSING');
await mkdir(OUT, { recursive: true });
await seed();
const providers = makeProviders(key);
console.log(`RESUME spent=${spent.toFixed(4)} done=${done.size} phase=${PHASE} dev=${uniqueDev.length}`);
if (PHASE === 'dev' || PHASE === 'all') await runQueue(uniqueDev, providers);
let decision;
const decisionPath = path.join(OUT, 'decision.json');
if (PHASE === 'rest' && !REDECIDE) {
  decision = JSON.parse(await readFile(decisionPath, 'utf8')).decision;
} else {
  const metricsA = pack(memory, 'A', 'dev');
  const metricsC = pack(memory, 'C', 'dev');
  decision = choose(metricsA, metricsC);
  const coverA = coverage(uniqueDev, 'A');
  const coverC = coverage(uniqueDev, 'C');
  if (coverA.okRate < 0.9 || coverC.okRate < 0.9) decision = { winner: 'A', reason: 'INCOMPLETE' };
  await writeFile(decisionPath, JSON.stringify({ decision, metricsA, metricsC, spent, coverA, coverC, addendum: decision.winner === 'C' ? ADDENDUM : null }, null, 2));
  console.log(`DECISION ${decision.winner} ${decision.reason} spent=${spent.toFixed(4)}`);
}
if (PHASE === 'dev') process.exit(0);
const winner = decision.winner === 'C' ? 'C' : 'A';
const rest = [...heldJobs(winner), ...probeJobs(winner, 14000)];
assertJobs(rest.filter(job => job.split === 'heldout'));
await runQueue(rest, providers);
await writeChain;
const summary = {
  createdAt: new Date().toISOString(),
  budgetUsd: BUDGET,
  estimatedSparkUsd: spent,
  priceNote: 'Local Spark price estimate from returned token counts for this round only, not a Meta invoice.',
  decision,
  devA: pack(memory, 'A', 'dev'),
  devC: pack(memory, 'C', 'dev'),
  heldout: pack(memory, winner, 'heldout'),
  probe: pack(memory, winner, 'probe'),
  calls: memory.length,
  failed: memory.filter(row => !row.ok).length,
  inputTokens: memory.reduce((sum, row) => sum + (row.inputTokens || 0), 0),
  outputTokens: memory.reduce((sum, row) => sum + (row.outputTokens || 0), 0),
};
await writeFile(path.join(OUT, 'campaign-summary.json'), JSON.stringify(summary, null, 2));
console.log(`ESTIMATED_USD=${spent.toFixed(4)} CALLS=${memory.length} WINNER=${winner} REASON=${decision.reason}`);
