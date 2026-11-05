/**
 * Budgeted Muse Spark accuracy runs on synthetic scenarios.
 * The key stays in the environment. Logs store ids, labels, and token counts only.
 * Stops before the local Spark estimate reaches the budget. That estimate is not a Meta invoice.
 * The rules engine and SafeBank hold are not modified.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LiveMetaProvider } from '../src/modules/analysis/meta-provider.ts';
import { estimateSparkUsd } from '../src/modules/cost/guard.ts';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'meta-budget');
const JSONL = path.join(OUT, 'calls.jsonl');
const DRY = process.argv.includes('--dry-run');
const budgetArg = process.argv.find(arg => arg.startsWith('--budget='));
const BUDGET = Number(budgetArg?.split('=')[1] ?? '10');
const concurrencyArg = process.argv.find(arg => arg.startsWith('--concurrency='));
const CONCURRENCY = Number(concurrencyArg?.split('=')[1] ?? '3');
if (!Number.isFinite(BUDGET) || BUDGET <= 0 || BUDGET > 10) throw new Error('BUDGET_OUT_OF_RANGE');
if (!Number.isSafeInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 4) throw new Error('CONCURRENCY_OUT_OF_RANGE');

const ADDENDUM = [
  '위험 단계 보정 규칙:',
  '상대가 사용자에게 송금, 이체, 입금, 카드번호, 비밀번호, 인증번호, 일회용 비밀번호, 원격 제어, 화면 공유, 또는 개인정보를 넣는 페이지 접속을 직접 요구하면 riskLevel은 HIGH다.',
  '권위 사칭, 긴급, 비밀 유지처럼 수상한 정황만 있고 그런 요구가 아직 없으면 HIGH로 올리지 말고 CAUTION 이하로 둔다.',
  '예방 교육, 뉴스, 사용자의 인용, 친구 이야기처럼 그 행동을 사용자에게 요구하지 않으면 LOW다.',
  'SIMULATED_GPS 위치만으로 단계를 올리지 않는다.',
].join('\n');
const EN_NOTE = '발화는 영어일 수 있다. 같은 기준으로 판단한다.';
const HELD_CORPUS = new Set(['txt_romance_crypto','txt_recovery_fee','txt_family_gift','txt_boss_invoice','txt_tech_renewal','txt_delivery_card','txt_family_dinner','txt_legit_recruiter','txt_clinic_appointment','txt_user_scary_quote']);

const orgs = ['검찰 수사팀','금융감독 상담','택배 고객센터','은행 보안팀','국세 환급 창구','카드 부정사용 데스크','가족 긴급 연락','회사 총무','투자 상담','대출 모집','통신 요금 센터','법원 서류 안내'];
const reasons = ['사건 연루','배송 주소 오류','계좌 도용 조사','세금 정산','카드 결제 오류','응급 비용','거래처 대금','수익 상품','대출 실행','요금 미납','통관 보류','출석 통지'];
const pressures = ['지금 확인하지 않으면 오늘 이용이 제한됩니다.','다른 곳에 알리면 절차가 중단됩니다.','확인이 늦어지면 불이익이 있습니다.','이 통화 안에서만 처리를 마쳐야 합니다.'];
const asks = ['안내에 따라 지금 지정 계좌로 이체해 주세요.','방금 받은 인증번호를 읽어 주세요.','카드번호와 비밀번호를 입력해 주세요.','원격 제어 앱을 설치하고 화면 공유를 켜 주세요.','링크 페이지에 주민등록번호와 계좌번호를 입력하세요.','진행 수수료를 먼저 입금해야 합니다.','예금을 안전 계좌로 옮겨 주세요.','앱에 표시된 일회용 비밀번호를 알려 주세요.'];
const foods = ['김치찌개','비빔밥','국수','샐러드','김밥','칼국수','된장찌개','초밥'];
const times = ['여섯 시','일곱 시','여덟 시','내일 아침','모레 점심','주말 오후','목요일 네 시','금요일 열한 시'];
const places = ['역 앞','회사 앞','집','공원','카페','학교 앞','도서관','시장'];
const normals = [
  ['오늘 저녁은 김치찌개 어때?','집에 도착하면 연락할게.','내일 보자.'],
  ['오후 진료는 세 시입니다.','보험 카드만 가져오시면 됩니다.','처방전은 데스크에서 드립니다.'],
  ['면접은 화요일 열 시입니다.','준비물은 이력서입니다.','참가비는 없습니다.'],
  ['택배가 문 앞에 있습니다.','사진으로 배송 완료를 남겼습니다.','분실이면 공식 앱에서 조회하세요.'],
  ['모임 장소는 역 앞입니다.','늦으면 먼저 들어가 있어.','식비는 각자 계산하자.'],
  ['은행 앱이 업데이트됐습니다.','번호는 카드 뒷면에서 직접 확인하세요.','이 전화로는 어떤 번호도 받지 않습니다.'],
];
const quotes = ['인증번호를 알려 달라더군요.','안전 계좌로 옮기라고 했답니다.','카드번호를 입력하라더군요.','원격 앱을 깔라고 했답니다.'];
const softTails = ['자세한 내용은 다음 안내에서 확인하겠습니다.','지금은 일정만 말씀드렸습니다.','필요하면 공식 창구로 다시 연락하겠습니다.','추가 서류는 아직 없습니다.'];

function turnsOf(lines) {
  return lines.map((text, index) => ({ turnId: `t${index + 1}`, speaker: 'caller', text }));
}
function slots(index) {
  return {
    org: orgs[index % orgs.length],
    reason: reasons[Math.floor(index / orgs.length) % reasons.length],
    pressure: pressures[(index * 3) % pressures.length],
    ask: asks[(index * 5) % asks.length],
  };
}
function easy(kind, index) {
  const { org, reason, pressure, ask } = slots(index);
  const tag = `접수 ${1000 + (index % 9000)}`;
  if (kind === 'explicit') return turnsOf([`${org}입니다. ${reason} 건, ${tag}.`, pressure, ask]);
  if (kind === 'soft') return turnsOf([`${org}입니다. ${reason} 안내, ${tag}.`, pressure, softTails[index % softTails.length]]);
  if (kind === 'normal') {
    const base = normals[index % normals.length].slice();
    base[0] = `${base[0]} ${times[index % times.length]} ${places[(index * 3) % places.length]} ${foods[(index * 5) % foods.length]}. 메모 ${1000 + (index % 9000)}.`;
    return turnsOf(base);
  }
  if (kind === 'edu') return turnsOf([`예방 교육 ${tag}입니다.`, `사례에서는 "${quotes[index % quotes.length]}"라고 말했습니다.`, '그 요구에는 응하지 마세요. 공식 번호로 직접 확인하세요.']);
  return turnsOf([`${tag} 편지가 왔다는 이야기만 들었습니다.`, '무엇을 하라는 말은 없었습니다.']);
}
function pushEasy(list, prompt, split, kind, gold, count, offset) {
  for (let i = 0; i < count; i++) {
    const id = `${split}_${kind}_${offset + i}`;
    list.push({ key: `${prompt}:${id}`, id, prompt, split, kind, gold, turns: easy(kind, offset + i) });
  }
}
function pushHard(list, prompt, item) {
  list.push({ key: `${prompt}:${item.id}`, id: item.id, prompt, split: item.split, kind: item.kind, gold: item.gold, turns: turnsOf(item.lines), location: item.location });
}

const hard = [
  { id: 'hard_parcel_url', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['등기 조회가 안 된다고 합니다.', '휴대폰 브라우저를 열어 주세요.', '그 페이지에 생년월일과 주소를 입력하세요.'] },
  { id: 'hard_wrong_deposit', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['번호가 잘못 연결된 것 같아요.', '그래도 수익이 나는 방이 있습니다.', '확인해 보시려면 소액을 먼저 입금해 주세요.'] },
  { id: 'hard_edu_flip', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['교육 차원에서 사례를 말씀드립니다.', '방금 고객님 폰으로 인증문자를 보냈습니다.', '그 숫자를 지금 읽어 주세요.'] },
  { id: 'hard_boss_gift', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['대표님 지시입니다.', '거래처 선물이 급합니다.', '상품권 코드를 사서 이 채팅으로 보내 주세요.'] },
  { id: 'hard_remote', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['컴퓨터 오류를 대신 봐 드리겠습니다.', '원격 제어 프로그램을 설치하세요.', '화면 공유를 켜고 제 지시를 따르세요.'] },
  { id: 'hard_tax_password', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['환급금이 대기 중입니다.', '본인 계좌 확인이 필요합니다.', '인터넷뱅킹 비밀번호를 알려 주세요.'] },
  { id: 'hard_child_account', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['엄마, 나 사고 나서 급해.', '예전 계좌는 막혔어.', '새 계좌로 지금 이체해 줘.'] },
  { id: 'hard_customs', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['해외 택배가 통관에서 멈췄습니다.', '소액 관세가 있습니다.', '카드번호를 불러 주시면 대납 처리합니다.'] },
  { id: 'hard_job_fee', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['최종 합격입니다.', '교육비 선납이 있습니다.', '오늘 중으로 훈련비를 입금해 주세요.'] },
  { id: 'hard_otp_en', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['This is the bank security desk.', 'A one-time code was just sent to your phone.', 'Read that code to me now.'] },
  { id: 'hard_screen_en', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['I will repair the account for you.', 'Install the remote app.', 'Turn on screen sharing and do not hang up.'] },
  { id: 'hard_safe_account', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['고객 예금이 위험합니다.', '지금 창구로 가셔야 합니다.', '잔액을 안전 계좌로 이체하세요.'] },
  { id: 'hard_prosecutor_pay', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['사건 관련자입니다.', '가족에게 말하면 구속될 수 있습니다.', '합의금을 지정 계좌로 송금하세요.'] },
  { id: 'hard_toll_id', split: 'dev', kind: 'explicit', gold: 'HIGH', lines: ['통행료 미납 안내입니다.', '링크를 눌러 주세요.', '주민등록번호로 본인 확인을 마치세요.'] },
  { id: 'hard_romance_soft', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['어제 이야기 고마웠어요.', '제가 아는 투자 모임이 있어요.', '수익이 좋다는 말만 먼저 드릴게요.'] },
  { id: 'hard_profit_soft', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['원금이 보장되는 자리입니다.', '오늘만 참여할 수 있습니다.', '세부 금액은 다음 통화에서 안내하겠습니다.'] },
  { id: 'hard_secrecy_soft', split: 'dev', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['수사 협조 전화입니다.', '가족에게는 비밀로 해 주세요.', '구체적인 요청은 아직 없습니다.'] },
  { id: 'hard_news', split: 'dev', kind: 'edu', gold: 'LOW', lines: ['뉴스 인터뷰입니다.', '범인이 인증번호를 요구했다는 인용입니다.', '시청자는 그 요구를 거절해야 합니다.'] },
  { id: 'hard_friend_story', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['내 친구가 인증번호를 읽어 줬다가 당했대.', '그래서 나는 안 알려 줬어.', '너는 공식 앱만 쓰자.'] },
  { id: 'hard_real_parcel', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['택배 기사입니다.', '부재중이라 문 앞에 두었습니다.', '추가 요금은 없습니다.'] },
  { id: 'hard_bank_hangup', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['은행에서는 전화로 비밀번호를 묻지 않습니다.', '의심되면 끊으세요.', '카드 뒷면 번호로 직접 거세요.'] },
  { id: 'hard_clinic', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['내일 검진 예약 확인입니다.', '아침 아홉 시입니다.', '비용 안내는 창구에서 합니다.'] },
  { id: 'hard_user_brag', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['방금 수상한 전화가 왔었어.', '인증번호를 달래서 내가 거절했지.', '너는 어떻게 생각해?'] },
  { id: 'hard_dinner', split: 'dev', kind: 'normal', gold: 'LOW', lines: ['오늘 저녁 뭐 먹을래?', '나는 국수가 좋아.', '일곱 시에 보자.'] },
  { id: 'hard_loc_dinner', split: 'dev', kind: 'location', gold: 'LOW', location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' }, lines: ['저녁에 뭐 먹을까?', '은행 앞을 지나가고 있어.', '밥만 먹고 들어가자.'] },
  { id: 'hard_loc_transfer', split: 'dev', kind: 'location', gold: 'HIGH', location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' }, lines: ['창구 앞에 계시죠.', '직원에게는 개인 송금이라고 하세요.', '지금 안전 계좌로 이체하세요.'] },
  { id: 'hard_loc_away', split: 'dev', kind: 'location', gold: 'HIGH', location: { source: 'SIMULATED_GPS', zone: 'AWAY', distanceBand: 'FAR' }, lines: ['집에 계셔도 됩니다.', '앱에서 처리하면 됩니다.', '잔액을 지정 계좌로 이체하세요.'] },
  { id: 'hard_loc_edu', split: 'dev', kind: 'location', gold: 'LOW', location: { source: 'SIMULATED_GPS', zone: 'AT_BANK', distanceBand: 'ARRIVED' }, lines: ['은행 앞에서 하는 예방 교육입니다.', '직원이라고 해도 비밀번호는 주지 마세요.', '의심되면 공식 번호로 끊고 거세요.'] },
  { id: 'hold_redelivery_card', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['재배달 수수료가 있습니다.', '링크는 이미 보내 드렸습니다.', '거기 카드번호와 유효기간을 입력하세요.'] },
  { id: 'hold_investigator', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['금융 조사관입니다.', '가족에게 알리지 마세요.', '예금을 보호 계좌로 송금하세요.'] },
  { id: 'hold_anydesk', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['Support will fix the frozen account.', 'Download the remote control tool.', 'Share your screen and approve the transfer.'] },
  { id: 'hold_training_fee', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['채용 확정 문자입니다.', '장비 보증금이 필요합니다.', '오늘 보증금을 입금해 주세요.'] },
  { id: 'hold_giftcard', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['아들인데 폰이 바뀌었어.', '지금 밖이라 결제가 안 돼.', '상품권을 사서 코드만 보내 줘.'] },
  { id: 'hold_otp_ko', split: 'heldout', kind: 'explicit', gold: 'HIGH', lines: ['본인 확인 절차입니다.', '문자로 여섯 자리를 보냈습니다.', '그 인증번호를 그대로 읽어 주세요.'] },
  { id: 'hold_invest_soft', split: 'heldout', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['지인 추천으로 연락드렸습니다.', '최근 수익이 좋았습니다.', '참여 방법은 다음에 설명하겠습니다.'] },
  { id: 'hold_parcel_soft', split: 'heldout', kind: 'soft', gold: 'AT_LEAST_CAUTION', lines: ['배송이 보류됐다는 안내입니다.', '오늘 안에 확인이 필요하다고 합니다.', '아직 주소만 맞는지 묻는 단계입니다.'] },
  { id: 'hold_dinner', split: 'heldout', kind: 'normal', gold: 'LOW', lines: ['주말에 부모님 댁에 갈까?', '케이크는 내가 살게.', '오후 두 시에 역에서 만나자.'] },
  { id: 'hold_recruiter', split: 'heldout', kind: 'normal', gold: 'LOW', lines: ['서류 검토가 끝났습니다.', '다음 면접은 온라인입니다.', '참가비는 없습니다.'] },
  { id: 'hold_edu_transfer', split: 'heldout', kind: 'edu', gold: 'LOW', lines: ['사기 예방 수업입니다.', '안전 계좌로 옮기라는 대사를 그대로 읽겠습니다.', '그런 이체 요구는 거절하는 것이 교육 내용입니다.'] },
  { id: 'hold_user_quote', split: 'heldout', kind: 'normal', gold: 'LOW', lines: ['아까 누가 협박하듯이 말했어.', '나는 끊었고 아무것도 안 보냈어.', '너도 이상한 번호는 받지 마.'] },
];

function corpusGold(category) {
  if (category === 'FRAUD_PATTERN') return 'DETECT';
  if (category === 'NORMAL') return 'LOW';
  return 'AMBIG';
}
async function readCorpus() {
  return JSON.parse(await readFile(path.join(ROOT, 'data', 'v137', 'text-corpus.json'), 'utf8'));
}
function fullTurns(item) {
  return item.turns.map((turn, index) => ({ turnId: `t${index + 1}`, speaker: turn.speaker, text: turn.text }));
}
async function loadCorpusJobs(prompt, mode) {
  const corpus = await readCorpus();
  const jobs = [];
  for (const item of corpus.cases) {
    const split = HELD_CORPUS.has(item.id) ? 'heldout' : 'dev';
    const full = fullTurns(item);
    if (mode === 'full' && split === 'heldout') jobs.push({ key: `${prompt}:${item.id}`, id: item.id, prompt, split, kind: 'corpus', gold: corpusGold(item.category), turns: full });
    if (mode === 'dev' && split === 'dev' && prompt === 'B') jobs.push({ key: `${prompt}:${item.id}`, id: item.id, prompt, split, kind: 'corpus', gold: corpusGold(item.category), turns: full });
    if (mode !== 'dev' || split !== 'dev') continue;
    const cuts = full.length > 2 ? [1, full.length - 1] : [1];
    for (const cut of cuts) {
      if (cut >= full.length) continue;
      const id = `${item.id}_p${cut}`;
      jobs.push({ key: `${prompt}:${id}`, id, prompt, split, kind: 'prefix', gold: 'OPEN', parentId: item.id, prefixLen: cut, turns: full.slice(0, cut).map((turn, index) => ({ ...turn, turnId: `t${index + 1}` })) });
    }
  }
  return jobs;
}
async function englishJobs(prompt, addendum) {
  const jobs = [];
  const specs = [
    ['training-bank-20-en', [[4, 'OPEN'], [8, 'AT_LEAST_CAUTION'], [12, 'HIGH'], [16, 'HIGH'], [20, 'HIGH']]],
    ['training-delivery-20-en', [[4, 'OPEN'], [8, 'HIGH'], [12, 'HIGH'], [16, 'HIGH'], [20, 'HIGH']]],
  ];
  for (const [file, cuts] of specs) {
    const manifest = JSON.parse(await readFile(path.join(ROOT, 'demo', 'safety-challenge', 'media', `${file}.manifest.json`), 'utf8'));
    const full = manifest.turns.map((turn, index) => ({ turnId: `t${index + 1}`, speaker: turn.role, text: turn.text }));
    for (const [cut, gold] of cuts) {
      const id = `${file}_t${cut}`;
      jobs.push({ key: `${prompt}:${id}`, id, prompt, split: 'heldout', kind: 'english', gold, lang: 'en', addendum, turns: full.slice(0, cut) });
    }
  }
  return jobs;
}
function buildGenerated(prompt) {
  const jobs = [];
  for (const item of hard) if (item.split === 'dev') pushHard(jobs, prompt, item);
  pushEasy(jobs, prompt, 'dev', 'explicit', 'HIGH', 350, 0);
  pushEasy(jobs, prompt, 'dev', 'normal', 'LOW', 120, 1000);
  pushEasy(jobs, prompt, 'dev', 'edu', 'LOW', 50, 2000);
  pushEasy(jobs, prompt, 'dev', 'soft', 'AT_LEAST_CAUTION', 40, 3000);
  pushEasy(jobs, prompt, 'dev', 'ambig', 'AMBIG', 24, 4000);
  return jobs;
}
function buildHeldGenerated(prompt) {
  const jobs = [];
  for (const item of hard) if (item.split === 'heldout') pushHard(jobs, prompt, item);
  pushEasy(jobs, prompt, 'heldout', 'explicit', 'HIGH', 100, 20000);
  pushEasy(jobs, prompt, 'heldout', 'normal', 'LOW', 40, 21000);
  pushEasy(jobs, prompt, 'heldout', 'edu', 'LOW', 20, 22000);
  pushEasy(jobs, prompt, 'heldout', 'soft', 'AT_LEAST_CAUTION', 16, 23000);
  pushEasy(jobs, prompt, 'heldout', 'ambig', 'AMBIG', 8, 24000);
  return jobs;
}
function buildProbe(prompt, count) {
  const jobs = [];
  const kinds = [
    ['explicit', 'HIGH'], ['explicit', 'HIGH'], ['explicit', 'HIGH'], ['explicit', 'HIGH'],
    ['normal', 'LOW'], ['normal', 'LOW'], ['edu', 'LOW'], ['edu', 'LOW'],
    ['soft', 'AT_LEAST_CAUTION'], ['ambig', 'AMBIG'],
  ];
  for (let i = 0; i < count; i++) {
    const [kind, gold] = kinds[i % kinds.length];
    const id = `probe_${kind}_${80000 + i}`;
    jobs.push({ key: `${prompt}:${id}`, id, prompt, split: 'probe', kind, gold, turns: easy(kind, 80000 + i) });
  }
  return jobs;
}

function detected(level) { return level === 'HIGH' || level === 'CAUTION'; }
function hit(row) {
  if (!row.ok) return false;
  if (row.gold === 'HIGH') return row.riskLevel === 'HIGH';
  if (row.gold === 'LOW') return row.riskLevel === 'LOW';
  if (row.gold === 'AT_LEAST_CAUTION' || row.gold === 'DETECT') return detected(row.riskLevel);
  return false;
}
function ratio(rows) {
  const scored = rows.filter(row => row.ok && row.gold !== 'OPEN' && row.gold !== 'AMBIG');
  if (!scored.length) return null;
  return scored.filter(hit).length / scored.length;
}
function countWhere(rows, pred) { return rows.filter(pred).length; }
function devRows(rows, prompt, split = 'dev') {
  return rows.filter(row => (row.prompt === prompt || row.prompt === `${prompt}-en`) && row.split === split && row.kind !== 'prefix');
}
function firstDetect(rows, prompt) {
  const groups = new Map();
  for (const row of rows) {
    if (row.prompt !== prompt || row.kind !== 'prefix' || !row.ok) continue;
    const list = groups.get(row.parentId) ?? [];
    list.push(row);
    groups.set(row.parentId, list);
  }
  const scores = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.prefixLen - b.prefixLen);
    const found = list.find(row => detected(row.riskLevel));
    scores.push(found ? found.prefixLen : list[list.length - 1].prefixLen + 1);
  }
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}
function pack(rows, prompt, split = 'dev') {
  const dev = devRows(rows, prompt, split);
  const explicit = dev.filter(row => row.gold === 'HIGH');
  const normal = dev.filter(row => row.gold === 'LOW' && (row.kind === 'normal' || row.kind === 'edu'));
  const edu = dev.filter(row => row.kind === 'edu');
  const soft = dev.filter(row => row.kind === 'soft');
  const locationLow = dev.filter(row => row.kind === 'location' && row.gold === 'LOW');
  const corpusFraud = dev.filter(row => row.kind === 'corpus' && row.gold === 'DETECT');
  const corpusNormal = dev.filter(row => row.kind === 'corpus' && row.gold === 'LOW');
  return {
    explicitHighRate: ratio(explicit),
    normalLowRate: ratio(normal),
    eduLowRate: ratio(edu),
    softHighRate: soft.length ? soft.filter(row => row.ok && row.riskLevel === 'HIGH').length / soft.length : null,
    locationLowMisses: locationLow.filter(row => row.ok && !hit(row)).length,
    fraudRecall: ratio(dev.filter(row => row.gold === 'HIGH' || row.gold === 'AT_LEAST_CAUTION' || row.gold === 'DETECT')),
    corpusFraudHigh: corpusFraud.filter(row => row.ok && row.riskLevel === 'HIGH').length,
    corpusFraudDetected: corpusFraud.filter(row => row.ok && detected(row.riskLevel)).length,
    corpusFraudN: corpusFraud.length,
    corpusNormalMisses: corpusNormal.filter(row => row.ok && !hit(row)).length,
    earlyTurns: firstDetect(rows, prompt),
    scored: dev.filter(row => row.ok).length,
  };
}
function choose(a, b) {
  if (!a || !b) return { winner: 'A', reason: 'INCOMPLETE' };
  const constraints = [
    b.fraudRecall !== null && a.fraudRecall !== null && b.fraudRecall + 1e-9 >= a.fraudRecall,
    b.normalLowRate !== null && a.normalLowRate !== null && b.normalLowRate + 1e-9 >= a.normalLowRate,
    b.eduLowRate !== null && a.eduLowRate !== null && b.eduLowRate + 1e-9 >= a.eduLowRate,
    b.locationLowMisses <= a.locationLowMisses,
    b.corpusNormalMisses <= a.corpusNormalMisses,
    b.corpusFraudDetected >= a.corpusFraudDetected,
    b.explicitHighRate !== null && a.explicitHighRate !== null && b.explicitHighRate + 0.005 >= a.explicitHighRate,
    a.softHighRate === null || b.softHighRate === null || b.softHighRate <= a.softHighRate + 0.03,
    a.earlyTurns === null || b.earlyTurns === null || b.earlyTurns <= a.earlyTurns + 0.5,
  ];
  if (constraints.some(ok => !ok)) return { winner: 'A', reason: 'CONSTRAINT' };
  const easier = b.explicitHighRate > a.explicitHighRate + 0.02;
  const corpus = b.corpusFraudHigh > a.corpusFraudHigh;
  if (easier || corpus) return { winner: 'B', reason: easier ? 'EXPLICIT_HIGH' : 'CORPUS_HIGH' };
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
function commit(usd) {
  reserved -= RESERVE;
  spent += usd;
}
function remember(row) {
  const stored = { ...row };
  delete stored.turns;
  delete stored.location;
  delete stored.addendum;
  memory.push(stored);
  writeChain = writeChain.then(() => appendFile(JSONL, `${JSON.stringify(stored)}\n`));
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
      if ((name === 'RATE_LIMIT' || name === 'TIMEOUT' || name === 'UPSTREAM') && attempt === 1) {
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
      let job;
      while (cursor < jobs.length && done.has(jobs[cursor].key)) cursor += 1;
      if (cursor >= jobs.length) { reserved -= RESERVE; return; }
      job = jobs[cursor++];
      const row = await execute(job, providers[job.prompt]);
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

async function seedBaseline() {
  let raw;
  try { raw = await readFile(JSONL, 'utf8'); } catch { raw = ''; }
  if (raw.trim()) {
    for (const line of raw.split(/\n+/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      memory.push(row);
      spent += row.usd;
      if (row.ok) done.add(row.key);
    }
    return;
  }
  const baseline = JSON.parse(await readFile(path.join(OUT, 'latest.json'), 'utf8'));
  const corpus = await readCorpus();
  if (!Array.isArray(baseline.rows)) throw new Error('BASELINE_ROWS_MISSING');
  for (const row of baseline.rows) {
    const item = corpus.cases.find(candidate => candidate.id === row.id);
    const seeded = { key: `A:${row.id}`, id: row.id, prompt: 'A', split: row.split, kind: 'corpus', gold: corpusGold(item?.category ?? 'AMBIGUOUS'), parentId: null, prefixLen: null, ok: row.ok, riskLevel: row.riskLevel, inputTokens: row.inputTokens, outputTokens: row.outputTokens, usd: row.usd + (row.ok ? 0 : 0.02), error: row.error };
    memory.push(seeded);
    spent += seeded.usd;
    if (seeded.ok) done.add(seeded.key);
    await appendFile(JSONL, `${JSON.stringify(seeded)}\n`);
  }
  if (Math.abs(spent - baseline.estimatedSparkUsd) > 0.002) spent = baseline.estimatedSparkUsd;
}

function providersFor(apiKey, winner) {
  const base = { apiKey, timeoutMs: 30000, sourceContext: 'SYNTHETIC_SCRIPTED_TEXT' };
  const map = {
    A: new LiveMetaProvider(base),
    B: new LiveMetaProvider({ ...base, instructionAddendum: ADDENDUM }),
  };
  map[winner] = map[winner] ?? map.A;
  map[`${winner}-en`] = new LiveMetaProvider({ ...base, instructionAddendum: winner === 'B' ? `${ADDENDUM}\n${EN_NOTE}` : EN_NOTE });
  return map;
}

if (ADDENDUM.length > 800) throw new Error('ADDENDUM_TOO_LONG');
const phase1 = [...await loadCorpusJobs('A', 'dev'), ...await loadCorpusJobs('B', 'dev'), ...buildGenerated('A'), ...buildGenerated('B')];
const uniquePhase1 = [];
const seen = new Set();
for (const job of phase1) {
  if (seen.has(job.key)) continue;
  seen.add(job.key);
  uniquePhase1.push(job);
}
if (DRY) {
  const by = {};
  const texts = new Set();
  for (const job of uniquePhase1) {
    by[`${job.prompt}:${job.split}:${job.kind}`] = (by[`${job.prompt}:${job.split}:${job.kind}`] ?? 0) + 1;
    texts.add(job.turns.map(turn => turn.text).join('\n'));
  }
  console.log(JSON.stringify({ dryRun: true, phase1: uniquePhase1.length, uniqueTexts: texts.size, by, addendumChars: ADDENDUM.length, englishAddendumChars: `${ADDENDUM}\n${EN_NOTE}`.length }, null, 2));
  process.exit(0);
}
const key = process.env.MODEL_API_KEY ?? '';
if (key.trim().length < 12) throw new Error('MODEL_API_KEY_MISSING');
await mkdir(OUT, { recursive: true });
await seedBaseline();
console.log(`RESUME spent=${spent.toFixed(4)} done=${done.size} phase1=${uniquePhase1.length}`);
const live = { A: null, B: null };
function bind(apiKey) {
  const base = { apiKey, timeoutMs: 30000, sourceContext: 'SYNTHETIC_SCRIPTED_TEXT' };
  live.A = new LiveMetaProvider(base);
  live.B = new LiveMetaProvider({ ...base, instructionAddendum: ADDENDUM });
  return live;
}
await runQueue(uniquePhase1, bind(key));
const metricsA = pack(memory, 'A');
const metricsB = pack(memory, 'B');
const decision = choose(metricsA, metricsB);
function coverage(prompt) {
  const keys = uniquePhase1.filter(job => job.prompt === prompt && job.split === 'dev');
  const have = keys.filter(job => memory.some(row => row.key === job.key)).length;
  const ok = keys.filter(job => memory.some(row => row.key === job.key && row.ok)).length;
  return { expected: keys.length, have, okRate: keys.length ? ok / keys.length : 0 };
}
const coverA = coverage('A');
const coverB = coverage('B');
if (coverA.have < coverA.expected * 0.95 || coverB.have < coverB.expected * 0.95 || coverA.okRate < 0.9 || coverB.okRate < 0.9) {
  decision.winner = 'A';
  decision.reason = 'INCOMPLETE';
}
await writeFile(path.join(OUT, 'decision.json'), JSON.stringify({ decision, metricsA, metricsB, spent, coverA, coverB, addendum: decision.winner === 'B' ? ADDENDUM : null }, null, 2));
console.log(`DECISION ${decision.winner} ${decision.reason} spent=${spent.toFixed(4)}`);
const winner = decision.winner;
const heldCorpus = winner === 'B' ? await loadCorpusJobs('B', 'full') : [];
const phase2 = [...buildHeldGenerated(winner), ...heldCorpus, ...await englishJobs(winner, winner === 'B' ? `${ADDENDUM}\n${EN_NOTE}` : EN_NOTE), ...buildProbe(winner, 1800)];
const enProvider = new LiveMetaProvider({ apiKey: key, timeoutMs: 30000, sourceContext: 'SYNTHETIC_SCRIPTED_TEXT', instructionAddendum: winner === 'B' ? `${ADDENDUM}\n${EN_NOTE}` : EN_NOTE });
const phase2Providers = { A: live.A, B: live.B, [winner]: winner === 'B' ? live.B : live.A };
for (const job of phase2) if (job.lang === 'en') job.prompt = `${winner}-en`;
phase2Providers[`${winner}-en`] = enProvider;
await runQueue(phase2, phase2Providers);
await writeChain;
function subset(split, prompt) {
  return memory.filter(row => row.split === split && (row.prompt === prompt || row.prompt === `${prompt}-en`));
}
const summary = {
  createdAt: new Date().toISOString(),
  budgetUsd: BUDGET,
  estimatedSparkUsd: spent,
  priceNote: 'Local Spark price estimate from returned token counts, not a Meta invoice. Unknown billed usage can differ.',
  decision,
  devA: metricsA,
  devB: metricsB,
  heldout: pack(subset('heldout', winner).map(row => ({ ...row, prompt: winner })), winner, 'heldout'),
  probe: pack(subset('probe', winner).map(row => ({ ...row, prompt: winner })), winner, 'probe'),
  english: memory.filter(row => row.kind === 'english').map(row => ({ id: row.id, riskLevel: row.riskLevel, gold: row.gold, ok: row.ok })),
  calls: memory.length,
  failed: memory.filter(row => !row.ok).length,
  inputTokens: memory.reduce((sum, row) => sum + (row.inputTokens || 0), 0),
  outputTokens: memory.reduce((sum, row) => sum + (row.outputTokens || 0), 0),
};
await writeFile(path.join(OUT, 'campaign-summary.json'), JSON.stringify(summary, null, 2));
await writeFile(path.join(OUT, 'latest.json'), JSON.stringify(summary, null, 2));
console.log(`ESTIMATED_USD=${spent.toFixed(4)} CALLS=${memory.length} WINNER=${winner} REASON=${decision.reason}`);
