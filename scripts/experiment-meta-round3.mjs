/**
 * Direct-speech Muse Spark comparison.
 * Round 2 already spent about $9.16 on reported speech ("~합니다").
 * This run's own cap stays inside the remaining room under $40.
 * The local estimate is not a Meta invoice. The model cannot change SafeBank.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LiveMetaProvider } from '../src/modules/analysis/meta-provider.ts';
import { estimateSparkUsd } from '../src/modules/cost/guard.ts';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'meta-budget', 'round3');
const JSONL = path.join(OUT, 'calls.jsonl');
const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const DRY = process.argv.includes('--dry-run');
const BUDGET = Number(arg('budget', '30'));
const CONCURRENCY = Number(arg('concurrency', '4'));
const PHASE = arg('phase', 'dev');
if (!Number.isFinite(BUDGET) || BUDGET <= 0 || BUDGET > 30.5) throw new Error('BUDGET_OUT_OF_RANGE');
if (!Number.isSafeInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 4) throw new Error('CONCURRENCY_OUT_OF_RANGE');
if (!['dev', 'rest'].includes(PHASE)) throw new Error('PHASE');

const ADDENDUM = [
  '추가 보정:',
  '권위 사칭, 비밀로 하라, 오늘 안의 불이익, 수익 보장, 공식 채널을 쓰지 말라는 말 중 둘이 겹치고, 아직 송금·인증·카드·원격·개인정보 요구가 없으면 riskLevel은 CAUTION이다.',
  '그 경우 LOW로 내리지 마라. HIGH로 올리지도 마라.',
  '일상 약속, 진료 예약, 배송 완료 안내, 예방 교육에서 사기 문장을 인용만 한 경우, 공식 번호로 직접 끊고 확인하라는 안내는 LOW다.',
  '직접 요구가 있으면 기존 규칙대로 HIGH다.',
  'SIMULATED_GPS만으로 단계를 올리지 마라.',
].join('\n');
const EN_NOTE = '발화는 영어일 수 있다. 같은 기준으로 판단한다.';
const ASK = /이체|입금|송금|카드번호|인증번호|비밀번호|원격|화면 공유|주민등록|상품권|몸값|시드|gift card|one-time code|transfer|password|remote screen|card number|seed phrase|wire the|pay the fee|deposit the/i;

const asks = [
  '미납금을 이 계좌로 지금 송금하세요.',
  '상품권 코드를 지금 보내 주세요.',
  '카드번호를 이 페이지에 입력하세요.',
  '인증번호를 지금 읽어 주세요.',
  '인터넷 뱅킹 비밀번호를 알려 주세요.',
  '원격 제어 앱을 설치하고 화면 공유를 켜 주세요.',
  '복구 시드를 순서대로 읽어 주세요.',
  '몸값을 지정 계좌로 이체하세요.',
];
const asksEn = [
  'Transfer the balance to this account now.',
  'Send the gift card code on your phone.',
  'Enter the card number on this page.',
  'Read the one-time code to me.',
  'Tell me the banking password.',
  'Install the remote tool and turn on remote screen sharing.',
  'Read the seed phrase in order.',
  'Wire the fee to the account I name.',
];
const roles = ['검찰 수사관', '은행 보안팀', '한전 고객센터', '학교 행정실', '통신사 보안센터', '세무 조사관', '병원 수납 담당', '거래소 보안팀'];
const rolesEn = ['the tax office', 'your bank security desk', 'the power company', 'the school office', 'the phone carrier', 'the court clerk', 'the hospital billing desk', 'the exchange security team'];
const pressures = ['오늘 밤이면 늦습니다.', '지금 끊으면 불이익이 있습니다.', '가족에게는 비밀로 해 주세요.', '다른 기관에는 연락하지 마세요.'];
const pressuresEn = ['This expires tonight.', 'Hanging up starts a penalty today.', 'Do not tell your family.', 'Do not call another office.'];
const softOpen = ['사이버 수사팀입니다.', '비공개 투자 안내입니다.', '배송 확인 담당입니다.', '법원 서류팀입니다.', '혜택 검토 담당입니다.', '커뮤니티 운영자입니다.'];
const softMid = ['오늘 안에 불이익이 생길 수 있습니다.', '오늘만 설명이 가능합니다.', '가족에게는 비밀로 해 주세요.', '공식 앱은 아직 열지 마세요.', '다른 사람에게는 알리지 마세요.', '지연되면 계정이 불편해질 수 있습니다.'];
const softEnd = ['구체적인 요청은 다음 통화에서 말씀드리겠습니다.', '오늘은 상황만 알려 드립니다.', '금액은 아직 말하지 않겠습니다.', '링크는 나중에 안내하겠습니다.'];
const meals = ['김치찌개', '비빔밥', '국수', '샐러드', '김밥', '초밥'];
const spots = ['역 앞', '회사 앞', '공원', '도서관', '시장', '카페'];
const hours = ['여섯 시', '일곱 시', '여덟 시', '내일 아침', '목요일 네 시', '금요일 열한 시'];

function turnsOf(lines) {
  return lines.map((text, index) => ({ turnId: `t${index + 1}`, speaker: 'caller', text }));
}
function isEnglish(lines) { return lines.some(line => /[A-Za-z]{4}/.test(line)); }
function explicitLines(index) {
  if (index % 5 === 0) {
    const n = index % asksEn.length;
    return [`This is ${rolesEn[n]}.`, pressuresEn[n % pressuresEn.length], asksEn[n]];
  }
  const n = index % asks.length;
  return [`${roles[n]}입니다.`, pressures[n % pressures.length], asks[n]];
}
function softLines(index) {
  if (index % 6 === 0) return ['This is a confidential account review.', 'Do not contact your bank yet.', 'They say delay today causes trouble.', 'No payment or code is being requested.'];
  return [softOpen[index % softOpen.length], softMid[index % softMid.length], softMid[(index + 3) % softMid.length], softEnd[index % softEnd.length]];
}
function normalLines(index) {
  if (index % 7 === 0) return [`Package ${1000 + (index % 50)} was left at the door.`, 'No extra charge is due.', 'Track it only in the official app.'];
  if (index % 7 === 1) return ['의심스러운 전화는 끊는 것이 맞습니다.', '비밀을 묻는 곳은 기관이 아닙니다.', '인쇄된 고객센터로 직접 거세요.'];
  return [`${hours[index % hours.length]}에 ${meals[index % meals.length]} 먹을래요?`, `${spots[index % spots.length]}에서 봅시다.`, '비용 안내는 없습니다.'];
}
function eduLines(index) {
  if (index % 2 === 0) return ['예방 교육 시간입니다.', '사례 속 인물이 인증번호를 읽으라고 말했습니다.', '여러분은 그 요구를 거절하고 공식 번호로 직접 끊으세요.'];
  return ['This is a scam-awareness class.', 'The quoted caller said "wire the savings to a safe account."', 'The lesson is to refuse and hang up.'];
}
function ambigLines(index) {
  return index % 2 === 0
    ? [`편지 ${index}가 왔다는 말만 들었습니다.`, '무엇을 하라는 안내는 없었습니다.']
    : ['오늘 당장 내려오라고만 합니다.', '이유는 말하지 않았습니다.'];
}
function narratedLines(index) {
  const reported = ['송금해 달라고 합니다.', '상품권 코드를 보내 달라고 합니다.', '카드번호를 넣으라고 합니다.', '인증번호를 읽어 달라고 합니다.', '비밀번호를 알려 달라고 합니다.', '원격 제어를 켜 달라고 합니다.', '시드를 읽어 달라고 합니다.', '이체해 달라고 합니다.'];
  return ['가족이 문제가 생겼다는 연락입니다.', '오늘 안에 처리해야 한다고 합니다.', reported[index % reported.length]];
}

function pushMany(list, prompt, split, kind, gold, count, offset, maker) {
  for (let i = 0; i < count; i++) {
    const index = offset + i;
    const lines = maker(index);
    const id = `${split}_${kind}_${index}`;
    list.push({ key: `${prompt}:${id}`, id, prompt, split, kind, gold, lang: isEnglish(lines) ? 'en' : 'ko', turns: turnsOf(lines) });
  }
}
function devJobs(prompt) {
  const jobs = [];
  pushMany(jobs, prompt, 'dev', 'explicit', 'HIGH', 120, 0, explicitLines);
  pushMany(jobs, prompt, 'dev', 'soft', 'AT_LEAST_CAUTION', 60, 0, softLines);
  pushMany(jobs, prompt, 'dev', 'normal', 'LOW', 60, 0, normalLines);
  pushMany(jobs, prompt, 'dev', 'edu', 'LOW', 24, 0, eduLines);
  pushMany(jobs, prompt, 'dev', 'ambig', 'AMBIG', 16, 0, ambigLines);
  pushMany(jobs, prompt, 'dev', 'narrated', 'HIGH', 16, 0, narratedLines);
  const places = [
    { id: 'dinner', gold: 'LOW', zone: 'AT_BANK', band: 'ARRIVED', lines: ['저녁 뭐 먹을까?', '은행 앞을 지나가는 중이야.', '밥 먹고 집에 가자.'] },
    { id: 'transfer', gold: 'HIGH', zone: 'AT_BANK', band: 'ARRIVED', lines: ['창구 앞에 계시죠.', '직원에게는 개인 일이라고 하세요.', '안전 계좌로 지금 이체하세요.'] },
    { id: 'lesson', gold: 'LOW', zone: 'NEAR_BANK', band: 'NEAR', lines: ['은행 앞 예방 교육입니다.', '직원이라고 해도 비밀번호는 주지 마세요.', '의심되면 끊고 공식 번호로 거세요.'] },
  ];
  for (const item of places) {
    jobs.push({ key: `${prompt}:dev_location_${item.id}`, id: `dev_location_${item.id}`, prompt, split: 'dev', kind: 'location', gold: item.gold, lang: 'ko', location: { source: 'SIMULATED_GPS', zone: item.zone, distanceBand: item.band }, turns: turnsOf(item.lines) });
  }
  return jobs;
}
function heldJobs(prompt) {
  const jobs = [];
  pushMany(jobs, prompt, 'heldout', 'explicit', 'HIGH', 80, 80000, explicitLines);
  pushMany(jobs, prompt, 'heldout', 'soft', 'AT_LEAST_CAUTION', 40, 80000, softLines);
  pushMany(jobs, prompt, 'heldout', 'normal', 'LOW', 40, 80000, normalLines);
  pushMany(jobs, prompt, 'heldout', 'edu', 'LOW', 16, 80000, eduLines);
  pushMany(jobs, prompt, 'heldout', 'narrated', 'HIGH', 16, 80000, narratedLines);
  return jobs;
}

function assertJobs(jobs) {
  for (const job of jobs) {
    const text = job.turns.map(turn => turn.text).join('\n');
    const asked = ASK.test(text);
    if (job.kind === 'explicit' && !asked) throw new Error(`EXPLICIT_WITHOUT_ASK ${job.id}`);
    if (['soft', 'normal', 'ambig'].includes(job.kind) && asked) throw new Error(`NONASK_HAS_ASK ${job.id}`);
  }
}
function detected(level) { return level === 'HIGH' || level === 'CAUTION'; }
function latestOf(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.key, row);
  return [...map.values()];
}
function ratio(rows, good) {
  const scored = rows.filter(row => row.ok);
  if (!scored.length) return null;
  return scored.filter(good).length / scored.length;
}
function pack(rows, prompt, split) {
  const main = latestOf(rows).filter(row => row.prompt === prompt && row.split === split && !['narrated'].includes(row.kind));
  const explicit = main.filter(row => row.gold === 'HIGH');
  const normal = main.filter(row => row.gold === 'LOW' && ['normal', 'edu'].includes(row.kind));
  const edu = main.filter(row => row.kind === 'edu');
  const soft = main.filter(row => row.kind === 'soft');
  const locationLow = main.filter(row => row.kind === 'location' && row.gold === 'LOW');
  const narrated = latestOf(rows).filter(row => row.prompt === prompt && row.split === split && row.kind === 'narrated');
  return {
    explicitHighRate: ratio(explicit, row => row.riskLevel === 'HIGH'),
    normalLowRate: ratio(normal, row => row.riskLevel === 'LOW'),
    eduLowRate: ratio(edu, row => row.riskLevel === 'LOW'),
    softDetectRate: ratio(soft, row => detected(row.riskLevel)),
    softHighRate: ratio(soft, row => row.riskLevel === 'HIGH'),
    locationLowMisses: locationLow.filter(row => row.ok && row.riskLevel !== 'LOW').length,
    narratedHighRate: ratio(narrated, row => row.riskLevel === 'HIGH'),
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
    a.softHighRate === null || b.softHighRate === null || b.softHighRate <= a.softHighRate + 0.02,
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
      return { key: job.key, id: job.id, prompt: job.prompt, split: job.split, kind: job.kind, gold: job.gold, ok: true, riskLevel: result.analysis.riskLevel, inputTokens, outputTokens, usd, error: null };
    } catch (error) {
      const name = error.kind || error.name || 'ERROR';
      if (['RATE_LIMIT', 'TIMEOUT', 'UPSTREAM', 'INVALID_RESPONSE'].includes(name) && attempt === 1) {
        liability += 0.02;
        await new Promise(resolve => setTimeout(resolve, name === 'RATE_LIMIT' ? 3000 : 700));
        continue;
      }
      return { key: job.key, id: job.id, prompt: job.prompt, split: job.split, kind: job.kind, gold: job.gold, ok: false, riskLevel: null, inputTokens: 0, outputTokens: 0, usd: liability + 0.02, error: name };
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
      if (finished % 20 === 0) await writeFile(path.join(OUT, 'progress.json'), JSON.stringify({ spent, finished, calls: memory.length }));
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
  return {
    A: new LiveMetaProvider(base),
    C: new LiveMetaProvider({ ...base, instructionAddendum: ADDENDUM }),
    'A-en': new LiveMetaProvider({ ...base, instructionAddendum: EN_NOTE }),
    'C-en': new LiveMetaProvider({ ...base, instructionAddendum: `${ADDENDUM}\n${EN_NOTE}` }),
  };
}

if (ADDENDUM.length > 700 || `${ADDENDUM}\n${EN_NOTE}`.length > 800) throw new Error('ADDENDUM_TOO_LONG');
const dev = [...devJobs('A'), ...devJobs('C')];
assertJobs(dev);
assertJobs(heldJobs('A'));
if (DRY) {
  const by = {};
  for (const job of dev) by[`${job.prompt}:${job.kind}`] = (by[`${job.prompt}:${job.kind}`] ?? 0) + 1;
  console.log(JSON.stringify({ dryRun: true, dev: dev.length, held: heldJobs('A').length, addendumChars: ADDENDUM.length, by }, null, 2));
  process.exit(0);
}
const key = process.env.MODEL_API_KEY ?? '';
if (key.trim().length < 12) throw new Error('MODEL_API_KEY_MISSING');
await mkdir(OUT, { recursive: true });
await seed();
const providers = makeProviders(key);
console.log(`RESUME spent=${spent.toFixed(4)} done=${done.size} phase=${PHASE}`);
if (PHASE === 'dev') {
  await runQueue(dev, providers);
  const metricsA = pack(memory, 'A', 'dev');
  const metricsC = pack(memory, 'C', 'dev');
  const decision = choose(metricsA, metricsC);
  await writeFile(path.join(OUT, 'decision.json'), JSON.stringify({ decision, metricsA, metricsC, spent, addendum: ADDENDUM }, null, 2));
  console.log(`DECISION ${decision.winner} ${decision.reason} spent=${spent.toFixed(4)}`);
  process.exit(0);
}
const decision = JSON.parse(await readFile(path.join(OUT, 'decision.json'), 'utf8')).decision;
const winner = decision.winner === 'C' ? 'C' : 'A';
await runQueue(heldJobs(winner), providers);
await writeFile(path.join(OUT, 'heldout.json'), JSON.stringify({ winner, heldout: pack(memory, winner, 'heldout'), spent }, null, 2));
console.log(`HELD spent=${spent.toFixed(4)} winner=${winner}`);
