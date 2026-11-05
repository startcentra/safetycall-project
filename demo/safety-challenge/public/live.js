/** SAFETYED /live — the browser plays the recording and reports its clock; every timeline event comes from the server. */
import {getLang, onLang, t, tServer, addMessages} from './i18n.js';
import {LIVE_MESSAGES} from './live-i18n.js';

addMessages(LIVE_MESSAGES);

const $ = id => document.getElementById(id);
const video = $('video'); // HTMLAudioElement; intentionally retains common media-clock naming
const ACTIVE = new Set(['CONNECTING', 'STREAMING', 'RECONNECTING', 'FLUSHING']);
const ROUTE = [[37.28644,127.00874],[37.28712,127.00915],[37.28795,127.00958],[37.28878,127.01008],[37.28966,127.01065],[37.29044,127.01116],[37.29125,127.01172],[37.29191,127.01204],[37.29220,127.01221]]
  .map(([lat, lng]) => [70 + (lng - 127.00874) / (127.01221 - 127.00874) * 470, 205 - (lat - 37.28644) / (37.2922 - 37.28644) * 164]);
const S = {
  auth: null, state: null, hud: null, catalog: null, readiness: null, epoch: 0, sse: null, conn: 'conn.pending',
  mode: 'replay',phase: 'idle', analysis: false, muted: false, connectTimer: null, clockTimer: null, clockInFlight: false, clockPending: false,
  lastReportedMs: 0, gateSeen: false, lastBand: null, modal: null, lastFocus: null, bank: null, error: null, frame: 0, hudAt: 0, transcriptKey: '', mediaPicked: false,
};

const fmt = ms => { const n = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const text = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? '—'); };
const el = (tag, cls, content) => { const n = document.createElement(tag); if (cls) n.className = cls; if (content !== undefined) n.textContent = content; return n; };
const locale = () => getLang() === 'en' ? 'en-US' : 'ko-KR';
const media = () => S.state?.media ?? null;
const provider = () => S.catalog?.asrProvider ?? 'DISABLED';
const selectedMedia = () => $('media-select').value;
const durationMs = () => (Number.isFinite(video.duration) ? video.duration * 1000 : (S.catalog?.cases?.find(c => c.id === selectedMedia())?.durationSeconds ?? 0) * 1000);

class RequestError extends Error { constructor(message, code, status) { super(message); this.code = code; this.status = status; } }
async function request(path, {method = 'GET', body, auth = true, timeout = 12000} = {}) {
  const headers = {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(auth && S.auth ? {'X-SafeCall-Session': S.auth.sessionId, 'X-SafeCall-Token': S.auth.parentToken} : {})};
  const response = await fetch(path, {method, headers, cache: 'no-store', ...(body !== undefined ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(timeout)});
  let data = {}; try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) throw new RequestError(data.error || `HTTP ${response.status}`, data.code || `HTTP_${response.status}`, response.status);
  return data;
}

/* ---------- session ---------- */
async function init() {
  const previous = S.auth;
  S.epoch++; S.sse?.abort(); clearTimeout(S.connectTimer); stopClock();
  video.pause(); video.removeAttribute('src'); video.load();
  Object.assign(S, {auth: null, state: null, hud: null, phase: 'idle', analysis: false, gateSeen: false, lastBand: null, bank: null, error: null, transcriptKey: '', lastReportedMs: 0});
  closeModal(); overlay(null); setConn('conn.pending'); loadVideo(); lockInputs(false); schedule();
  if (previous) void fetch('/api/session/close', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-SafeCall-Session': previous.sessionId, 'X-SafeCall-Token': previous.parentToken}, body: '{}', cache: 'no-store'}).catch(() => {});
  try {
    const created = await request('/api/session/create', {method: 'POST', auth: false, body: {scenarioId: 'kidnap', mode: 'guidance'}});
    S.auth = created.sessionCredentials; delete created.sessionCredentials;
    S.state = created; setConn('conn.ok'); schedule(); void stream(S.epoch); void refreshHud(true);
  } catch (error) { setConn('conn.fail'); S.error = error.code || 'SESSION_FAILED'; schedule(); }
}
function setConn(key) { S.conn = key; text('connection', t(key)); }
function accept(next) {
  if (!next || (S.state && next.runId !== S.state.runId)) return;
  if (S.state && next.version < S.state.version) return;
  S.state = next; onMediaState(); schedule(); void refreshHud();
}
async function stream(epoch) {
  const controller = new AbortController(); S.sse = controller;
  while (epoch === S.epoch && S.auth && !controller.signal.aborted) {
    try {
      const response = await fetch('/api/events', {headers: {'X-SafeCall-Session': S.auth.sessionId, 'X-SafeCall-Token': S.auth.parentToken}, cache: 'no-store', signal: controller.signal});
      if (!response.ok || !response.body) throw new Error('EVENTS_UNAVAILABLE');
      setConn('conn.ok');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        buffer += decoder.decode(value, {stream: true});
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (line) { try { accept(JSON.parse(line.slice(6))); } catch { /* partial frame */ } }
        }
      }
    } catch { if (controller.signal.aborted) return; setConn('conn.retry'); }
    if (epoch === S.epoch && !controller.signal.aborted) await new Promise(r => setTimeout(r, 1500));
  }
}
async function refreshHud(force = false) {
  if (!S.auth || (!force && Date.now() - S.hudAt < 800)) return;
  S.hudAt = Date.now();
  try { const hud = await request('/api/glasses/state'); if (hud.runId === S.state?.runId) { S.hud = hud; schedule(); } } catch { /* HUD is optional */ }
}

/* ---------- readiness ---------- */
async function loadReadiness() {
  try { [S.catalog, S.readiness] = await Promise.all([request('/api/media/catalog', {auth: false}), request('/api/readiness', {auth: false})]); }
  catch { S.catalog = {asrProvider: 'DISABLED', cases: []}; S.readiness = null; }
  const select = $('media-select'), known = new Set([...select.options].map(o => o.value));
  for (const c of S.catalog.cases ?? []) if (!known.has(c.id)) select.append(new Option(c.id, c.id));
  const usable = S.catalog.cases?.find(c => c.replayAvailable) ?? S.catalog.cases?.find(c => c.kind === 'SYNTHETIC_TTS');
  if (!S.mediaPicked && usable && S.phase === 'idle') { select.value = usable.id; loadVideo(); }
  schedule();
}
const mediaItem = () => S.catalog?.cases?.find(c => c.id === selectedMedia());
const transferBlocked = () => mediaItem()?.externalTransfer === 'NOT_AUTHORIZED';
function analysisAllowed() { return provider() !== 'DISABLED' && !transferBlocked() && $('rights').checked && $('consent').checked; }

/* ---------- playback & clock ---------- */
function loadVideo() {
  const src = `/media/${selectedMedia()}.wav`;
  if (video.getAttribute('src') !== src) { video.src = src; video.load(); }
}
function lockInputs(locked) { for (const id of ['media-select', 'rights', 'consent']) $(id).disabled = locked || (id !== 'media-select' && (S.mode === 'replay' || provider() === 'DISABLED' || transferBlocked())); for(const id of ['mode-replay','mode-live','shuffle-scenario']) $(id).disabled = locked; }

async function answer() {
  if (S.phase !== 'idle' || !S.state) return;
  const epoch = S.epoch;
  lockInputs(true); loadVideo(); S.error = null;
  // Prime playback inside the click so the later play() (after the ASR handshake) is not blocked by autoplay policy.
  try { video.muted = true; await video.play(); video.pause(); video.currentTime = 0; } catch { /* handled when playback starts */ }
  video.muted = S.muted;
  if (epoch !== S.epoch) return;
  if (S.mode !== 'replay' && !analysisAllowed()) { S.analysis = false; S.phase = 'live'; return startPlayback(); }
  S.analysis = true; S.phase = 'connecting';
  overlay({text: t(provider() === 'META' ? 'lv.connecting' : 'lv.connectingSim'), spinner: true}); schedule();
  try {
    const replay = S.mode === 'replay';
    const next = await request(replay?'/api/media/replay':'/api/media/start', {method:'POST',body:replay?{runId:S.state.runId,expectedVersion:S.state.version,mediaId:selectedMedia()}:{runId:S.state.runId,expectedVersion:S.state.version,mediaId:selectedMedia(),consented:true,rightsConfirmed:true,clockSource:'PLAYER'}});
    if (epoch !== S.epoch) return;
    accept(next);
    clearTimeout(S.connectTimer);
    S.connectTimer = setTimeout(() => { if (S.phase === 'connecting' && epoch === S.epoch) fail(replay?'REPLAY_START_TIMEOUT':'ASR_CONNECT_TIMEOUT'); }, replay?7000:25000);
  } catch (error) { if (epoch === S.epoch) fail(error.code || 'MEDIA_START_FAILED'); }
}
function fail(code) {
  clearTimeout(S.connectTimer); S.error = code; video.pause();
  if (S.phase === 'connecting' || S.phase === 'starting') { S.phase = 'idle'; S.analysis = false; lockInputs(false); }
  overlay({text: t('lv.err', {code}), button: t('lv.retry'), action: () => { overlay(null); if (S.phase === 'idle') void init(); }});
  schedule();
}
async function startPlayback() {
  clearTimeout(S.connectTimer);
  try {
    await video.play();
    S.phase = 'live'; overlay(null); startClock(); schedule();
  } catch {
    S.phase = 'blocked';
    overlay({text: t('lv.blocked'), button: t('lv.tapToPlay'), action: () => { overlay(null); void startPlayback(); }});
    schedule();
  }
}
function onMediaState() {
  const m = media(); if (!m) return;
  if (S.phase === 'connecting' && m.status === 'STREAMING') { S.phase = 'starting'; void startPlayback(); }
  else if ((S.phase === 'connecting' || S.phase === 'starting') && (m.status === 'ERROR' || m.status === 'STOPPED')) fail(m.errorCode || 'ASR_FAILED');
  if (!ACTIVE.has(m.status)) stopClock();
}
function startClock() { stopClock(); if (S.analysis) S.clockTimer = setInterval(() => void reportClock(), 250); }
function stopClock() { clearInterval(S.clockTimer); S.clockTimer = null; }
async function reportClock() {
  const m = media();
  if (!S.analysis || !m || !ACTIVE.has(m.status) || !S.auth) return;
  if (S.clockInFlight) { S.clockPending = true; return; }
  S.clockInFlight = true;
  const playing = !video.paused && !video.ended && video.readyState >= 3;
  const mediaTimeMs = Math.round(video.currentTime * 1000);
  S.lastReportedMs = mediaTimeMs;
  try { await request('/api/media/clock', {method: 'POST', body: {runId: S.state.runId, mediaTimeMs, playing}, timeout: 3000}); }
  catch { /* the server treats missing reports as a stalled player and sends silence */ }
  finally { S.clockInFlight = false; if (S.clockPending) { S.clockPending = false; void reportClock(); } }
}
for (const type of ['play', 'playing', 'pause', 'waiting', 'stalled', 'seeked', 'ended']) video.addEventListener(type, () => { void reportClock(); schedule(); });
video.addEventListener('seeking', () => {
  // Live analysis follows the audio actually streamed; a jump would desynchronize ASR time and video time.
  if (S.analysis && ACTIVE.has(media()?.status) && Math.abs(video.currentTime * 1000 - S.lastReportedMs) > 1500) video.currentTime = S.lastReportedMs / 1000;
});
video.addEventListener('ended', () => { if (S.phase === 'live' || S.phase === 'paused') S.phase = 'ended'; schedule(); });
video.addEventListener('error', () => { if (S.phase !== 'idle') fail('MEDIA_DECODE_FAILED'); else S.error = 'MEDIA_DECODE_FAILED'; schedule(); });
video.addEventListener('loadedmetadata', schedule);
video.addEventListener('timeupdate', () => { paintProgress(); highlight(); });

function togglePause() {
  if (S.phase === 'live') { video.pause(); S.phase = 'paused'; }
  else if (S.phase === 'paused') { S.phase = 'live'; void video.play().catch(() => { S.phase = 'paused'; }); }
  schedule();
}
async function endCall() {
  if (!['live', 'paused', 'connecting', 'starting', 'blocked'].includes(S.phase)) return;
  video.pause(); stopClock(); clearTimeout(S.connectTimer); overlay(null); S.phase = 'ended'; schedule();
  try { if (S.state && !S.state.callEndedAt) accept(await request('/api/action', {method: 'POST', body: {runId: S.state.runId, expectedVersion: S.state.version, action: 'END_CALL'}})); }
  catch (error) { S.error = error.code; schedule(); }
}
async function tryTransfer() {
  if (!S.state) return;
  try {
    accept(await request('/api/action', {method: 'POST', body: {runId: S.state.runId, expectedVersion: S.state.version, action: 'SIMULATED_TRANSFER'}}));
    S.bank = {ok: true};
  } catch (error) {
    S.bank = {ok: false, code: error.code};
    if (error.code === 'POLICY_DENIED') openModal('lv.modalDenied');
  }
  schedule();
}

/* ---------- overlay & modal ---------- */
function overlay(spec) {
  const node = $('overlay');
  if (!spec) { node.hidden = true; return; }
  node.hidden = false; $('overlay-spinner').hidden = !spec.spinner; text('overlay-text', spec.text);
  const button = $('overlay-btn'); button.hidden = !spec.button;
  if (spec.button) { button.textContent = spec.button; button.onclick = spec.action; button.focus(); }
}
function openModal(copyKey) {
  S.modal = copyKey; S.lastFocus = document.activeElement;
  $('safety-modal').hidden = false; text('modal-copy', t(copyKey)); $('modal-dismiss').focus();
}
function closeModal() { if ($('safety-modal').hidden) return; $('safety-modal').hidden = true; S.modal = null; S.lastFocus?.focus?.(); }

/* ---------- render ---------- */
function schedule() { if (!S.frame) S.frame = requestAnimationFrame(() => { S.frame = 0; render(); }); }
function render() {
  const s = S.state, m = media();
  document.body.dataset.phase = S.phase;
  text('case-id', s ? s.runId.slice(-10).toUpperCase() : '—');
  renderSource(); renderPhone(s, m); renderTranscript(s, m); renderEvents(m); renderSync(m);
  renderRisk(s); renderMeta(s); renderHud(); renderMap(s, m); renderBank(s); renderMonitor(m); renderLegend(m);
  paintProgress(); highlight();
}
function renderLegend(m) {
  const seen = new Set((m?.events ?? []).map(e => e.provenance));
  if (S.state?.ruleSignals?.length) seen.add('RULE_ENGINE');
  document.querySelectorAll('.legend .prov').forEach(li => li.classList.toggle('on', seen.has(li.dataset.prov)));
}
function renderSource() {
  const p = provider();
  text('mode-replay',getLang()==='ko'?'안정적 20턴 재현':'Stable 20-turn replay');text('mode-live',getLang()==='ko'?'Meta 실시간 인식':'Meta live ASR');
  text('shuffle-scenario',getLang()==='ko'?'↻ 다른 20턴 사건 선택':'↻ Choose another 20-turn case');
  const localOnly = transferBlocked();
  const replay=S.mode === 'replay' || !!media()?.replay;
  $('mode-replay').classList.toggle('active',S.mode==='replay');$('mode-live').classList.toggle('active',S.mode==='live');
  $('mode-replay').setAttribute('aria-pressed',String(S.mode==='replay'));$('mode-live').setAttribute('aria-pressed',String(S.mode==='live'));
  const md=$('mode-disclosure');md.dataset.mode=S.mode;md.textContent=replay?(getLang()==='ko'?`오프라인 20턴 · 시드 ${mediaItem()?.seed??'—'} · 규칙 엔진 · 실제 AI 미사용`:`OFFLINE 20-TURN REPLAY · SEED ${mediaItem()?.seed??'—'} · RULES ONLY · NO META/STT`):(getLang()==='ko'?'실제 Meta 음성 인식 · API 키/동의 필요':'META LIVE · ACTUAL ASR / API KEY + CONSENT REQUIRED');
  text('asr-provider', replay ? 'LOCAL RULE REPLAY' : !S.catalog ? '—' : localOnly ? t('lv.localOnly') : t('prov.' + (p === 'META' ? 'ACTUAL_STREAMED_ASR' : p === 'DISABLED' ? 'SYSTEM' : p)));
  $('asr-provider').dataset.prov = localOnly ? 'SYSTEM' : p === 'META' ? 'ACTUAL_STREAMED_ASR' : p;
  text('ready-note', replay ? (getLang()==='ko'?'촬영용 고정 시드: 재생된 발화만 규칙 엔진에 전달. Meta AI 호출 없음.':'Recording-safe seeded fixture. Reveals only spoken turns; no Meta AI calls.') : S.catalog ? t('lv.ready.' + p) : t('lv.ready.loading'));
  text('consent-text', t(p === 'LOCAL_CONTRACT_SIMULATOR' ? 'lv.consentSim' : 'lv.consent'));
  const audio = S.readiness?.media?.caps?.audioSecondsPerRun, calls = S.readiness?.maxCallsPerRun;
  text('caps', audio && p !== 'DISABLED' ? t('lv.caps', {audio, calls: calls ?? '—', usd: (audio / 3600 * 0.18).toFixed(3)}) : '');
  const blocked = transferBlocked(), hint = $('consent-hint');
  hint.dataset.i18n = blocked ? 'lv.transferBlocked' : 'lv.needConsent'; text('consent-hint', t(hint.dataset.i18n));
  hint.hidden = replay || p === 'DISABLED' || S.phase !== 'idle' || (!blocked && analysisAllowed());
  const kind = mediaItem()?.kind;
  text('media-kind', kind ? t('lv.kind.' + kind) : '');
  $('media-kind').dataset.prov = kind === 'SYNTHETIC_TTS' ? 'SCRIPTED_MOCK' : 'SYSTEM';
  if (S.phase === 'idle') lockInputs(false);
  for (const option of $('media-select').options) {
    option.hidden = S.mode==='replay' && !S.catalog?.cases?.find(c=>c.id===option.value)?.replayAvailable;
    const item = S.catalog?.cases?.find(c => c.id === option.value);
    option.textContent = `${(getLang()==='ko'?item?.titleKo:item?.title) ?? t('lv.media.' + option.value)}${item ? ' · ' + fmt(item.durationSeconds * 1000) : ''}`;
  }
}
function renderPhone(s, m) {
  const gate = !!s?.protectionGate?.blocked, band = s?.risk?.band ?? 'LOW';
  document.body.dataset.level = gate || band === 'HIGH' ? 'high' : band === 'CAUTION' ? 'caution' : 'low';
  const phaseKey = S.phase === 'idle' || S.phase === 'connecting' ? 'lv.incoming' : S.phase === 'ended' ? 'lv.callEnded' : 'lv.onCall';
  text('phone-phase', t(phaseKey)); text('caller-sub', t(phaseKey)); text('situation', (getLang()==='ko'?mediaItem()?.titleKo:mediaItem()?.title)??t('lv.media.' + selectedMedia()));
  $('incoming').hidden = false; // audio-only voice call keeps the caller visualization visible
  text('phone-clock', new Date().toLocaleTimeString(locale(), {hour: '2-digit', minute: '2-digit'}));
  $('answer').disabled = S.phase !== 'idle' || !s;
  $('pause').disabled = !(S.phase === 'live' || S.phase === 'paused');
  $('stop').disabled = !['live', 'paused', 'connecting', 'starting', 'blocked'].includes(S.phase);
  const paused = S.phase === 'paused';
  $('pause').setAttribute('aria-label', t(paused ? 'lv.resume' : 'lv.pause')); $('pause').querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  $('mute').setAttribute('aria-label', t(S.muted ? 'lv.unmute' : 'lv.mute')); $('mute').querySelector('use').setAttribute('href', S.muted ? '#i-volume-x' : '#i-volume');
  $('mute').setAttribute('aria-pressed', String(S.muted));
  $('answer').setAttribute('aria-label', t('lv.answer')); $('stop').setAttribute('aria-label', t('lv.stop'));
  const alert = $('phone-alert');
  alert.className = 'phone-alert' + (gate || band === 'HIGH' ? ' danger' : band === 'CAUTION' ? ' warning' : '');
  if (S.error) { text('alert-title', t('lv.err', {code: S.error})); text('alert-detail', ''); }
  else if (!S.analysis && S.phase !== 'idle') { text('alert-title', t('lv.st.AUDIO_ONLY')); text('alert-detail', t('lv.audioOnlyNote')); }
  else if (m?.status === 'ERROR') { text('alert-title', t('lv.err', {code: m.errorCode})); text('alert-detail', t('lv.audioOnlyNote')); }
  else { text('alert-title', t(gate ? 'lv.hold.on' : 'risk.' + band)); text('alert-detail', gate ? t('lv.modalDenied') : band === 'HIGH' ? t('lv.modalHigh') : t('lv.riskNote')); }
  if (gate && !S.gateSeen) { S.gateSeen = true; openModal('lv.modalDenied'); }
  if (s && band !== S.lastBand) { if (S.lastBand !== null) text('sr-status', t('lv.statusAnnounce', {band: t('risk.' + band)})); S.lastBand = band; }
}
function paintProgress() {
  const total = durationMs(), now = video.currentTime * 1000 || 0;
  $('progress-bar').style.width = total ? `${Math.min(100, now / total * 100)}%` : '0';
  $('progress-asr').style.width = total && media() ? `${Math.min(100, media().cost.mediaMs / total * 100)}%` : '0';
  text('time-cur', fmt(now)); text('time-total', fmt(total));
}
function reviewMode() { const m = media(); return !!m && !ACTIVE.has(m.status) && S.phase !== 'live'; }
function renderTranscript(s, m) {
  const box = $('transcript');
  const finals = (s?.transcript ?? []).filter(l => ['STREAMED_MEDIA_STT','SCRIPTED_TTS_REPLAY'].includes(l.source));
  const quarantined = m?.quarantined ?? [];
  const evidence = new Set(s?.metaReview?.review?.evidenceTurnIds ?? []);
  const signalTurns = new Map((s?.ruleSignals ?? []).filter(x => x.turnId).map(x => [x.turnId, x.code]));
  const key = [getLang(), finals.length, quarantined.length, m?.partial?.text ?? '', [...evidence].join(), [...signalTurns.keys()].join(), reviewMode(), S.analysis, S.phase, provider()].join('|');
  text('turn-counter', `${Math.min(20, finals.length)}/20`);
  $('seek-hint').hidden = !reviewMode() || !finals.length;
  if (key === S.transcriptKey) return;
  S.transcriptKey = key;
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  box.replaceChildren();
  const rows = [...finals.map(l => ({...l, kind: 'final'})), ...quarantined.map(q => ({...q, kind: 'quarantined'}))]
    .sort((a, b) => (a.startMediaMs ?? 0) - (b.startMediaMs ?? 0));
  if (!rows.length && !m?.partial) box.append(el('p', 'empty', t(m || S.analysis ? 'lv.transcriptEmpty' : (S.phase === 'idle' ? 'lv.transcriptEmpty' : 'lv.transcriptOff'))));
  for (const row of rows) {
    const line = el(reviewMode() && row.kind === 'final' ? 'button' : 'div', `line ${row.kind}`);
    if (line.tagName === 'BUTTON') { line.type = 'button'; line.addEventListener('click', () => { video.currentTime = (row.startMediaMs ?? 0) / 1000; void video.play().catch(() => {}); }); }
    line.dataset.start = row.startMediaMs ?? ''; line.dataset.end = row.endMediaMs ?? ''; if (row.turnId) line.dataset.turn = row.turnId;
    line.dataset.prov = row.provenance ?? m?.provenance?.asr ?? 'ACTUAL_STREAMED_ASR';
    const meta = el('span', 'line-meta');
    meta.append(el('time', '', `${fmt(row.startMediaMs)}–${fmt(row.endMediaMs)}`), el('span', 'tag', row.source === 'SCRIPTED_TTS_REPLAY' ? (getLang()==='ko'? '가상 역할':'Fictional role: '+row.speaker) : row.speakerLabel ? t('lv.speakerLabel', {label: row.speakerLabel}) : t('lv.unverified')));
    if (row.kind === 'quarantined') meta.append(el('span', 'tag warn', `${t('lv.quarantined')} · ${t('q.' + row.reason)}`));
    if (row.turnId && evidence.has(row.turnId)) meta.append(el('span', 'tag ai', t('lv.aiEvidence')));
    if (row.turnId && signalTurns.has(row.turnId)) meta.append(el('span', 'tag rule', t('sig.' + signalTurns.get(row.turnId))));
    line.append(meta, el('span', 'line-text', row.text));
    box.append(line);
  }
  if (m?.partial?.text) {
    const line = el('div', 'line partial'); line.dataset.prov = m.provenance?.asr;
    const meta = el('span', 'line-meta'); meta.append(el('time', '', fmt(m.partial.mediaTimeMs)), el('span', 'tag', t('lv.partial')));
    line.append(meta, el('span', 'line-text', m.partial.text)); box.append(line);
  }
  if (stick) box.scrollTop = box.scrollHeight;
}
function highlight() {
  const now = video.currentTime * 1000;
  for (const line of $('transcript').querySelectorAll('.line.final,.line.quarantined')) {
    const start = Number(line.dataset.start), end = Number(line.dataset.end);
    line.classList.toggle('now', Number.isFinite(start) && line.dataset.start !== '' && now >= start && now <= end + 400);
  }
}
function eventDetail(e) {
  switch (e.type) {
    case 'SCRIPT_TURN_FINAL': return `${e.turn}/20 · ${e.role} · ${e.text ?? ''}`;
    case 'REPLAY_READY': return `seed ${e.scenarioSeed} · 20 turns · offline rules only`;
    case 'ASR_FINAL': case 'ASR_PARTIAL': return e.text ?? '';
    case 'ASR_FINAL_QUARANTINED': return `${t('q.' + e.reason)} · ${e.text ?? ''}`;
    case 'RULES_UPDATED': return `${t('risk.' + e.riskBand)} · ${e.riskIndex}${e.newSignalCodes?.length ? ' · ' + e.newSignalCodes.map(c => t('sig.' + c)).join(', ') : ''}`;
    case 'AI_ANALYSIS_STARTED': return `${t('trig.' + e.reason)} · ${e.call}/${e.budget}`;
    case 'AI_ANALYSIS_COMPLETED': return `${e.riskLevel} · ${(e.evidenceTurnIds ?? []).length} ${t('lv.meta.evidence')}${e.accepted ? '' : ' · ' + t('lv.meta.notAccepted')}`;
    case 'AI_ANALYSIS_ERROR': return e.errorCode;
    case 'AI_ANALYSIS_SKIPPED': return `${t('trig.' + e.reason)} · ${t('cause.' + e.cause)}`;
    case 'SIMULATED_GPS': return `${t(zoneKey(e.zone))} · ${e.distanceMeters} m`;
    case 'ASR_ERROR': return [e.errorCode, e.closeCode && `WS ${e.closeCode}`, e.upstreamErrorType].filter(Boolean).join(' · ');
    case 'ASR_RECONNECTING': return `${e.reason} · #${e.attempt}`;
    case 'MEDIA_STOPPED': return e.reason ?? '';
    case 'AUDIO_COMPLETED': return `${e.usableFinals}/${e.finals}${e.closeCode ? ' · WS ' + e.closeCode : ''}`;
    default: return '';
  }
}
function renderEvents(m) {
  const list = $('events'), events = m?.events ?? [];
  text('event-count', String(events.length));
  list.replaceChildren();
  if (!events.length) { list.append(el('li', 'empty', t('lv.eventsEmpty'))); return; }
  for (const e of events.slice(-60).reverse()) {
    const li = el('li', 'event'); li.dataset.prov = e.provenance;
    const head = el('div', 'event-head');
    head.append(el('i', 'dot'), el('span', 'event-type', t('ev.' + e.type) === 'ev.' + e.type ? e.type : t('ev.' + e.type)), el('time', '', fmt(e.mediaTimeMs ?? e.endMediaMs ?? e.playerMs)));
    li.append(head);
    const detail = eventDetail(e); if (detail) li.append(el('p', 'event-detail', detail));
    list.append(li);
  }
}
function renderSync(m) {
  const status = m?.status ?? (S.phase !== 'idle' && !S.analysis ? 'AUDIO_ONLY' : 'IDLE');
  text('asr-status', t('lv.st.' + status)); $('asr-status').dataset.state = status;
  text('sync-player', m ? `${fmt(m.player.mediaMs)}${m.player.playing ? ' ▶' : ' ❚❚'}` : fmt(video.currentTime * 1000));
  text('sync-sent', m ? `${(m.cost.mediaMs / 1000).toFixed(1)} s` : '—');
  const lag = m?.latency?.playerLagMs;
  text('sync-lag', lag?.count ? `p50 ${(lag.p50 / 1000).toFixed(1)} s · p95 ${(lag.p95 / 1000).toFixed(1)} s` : '—');
  text('sync-partial', m?.partial?.text ? `${t('lv.partial')}: ${m.partial.text}` : '');
}
function renderRisk(s) {
  const band = s?.risk?.band ?? 'LOW', index = Math.max(0, Math.min(100, s?.risk?.index ?? 0));
  text('risk-band', t('risk.' + band)); $('risk-band').dataset.band = band;
  text('risk-index', String(index)); $('risk-fill').style.width = `${index}%`; $('risk-fill').dataset.band = band;
  const list = $('signals'); list.replaceChildren();
  const signals = s?.ruleSignals ?? [];
  if (!signals.length) { list.append(el('li', 'empty', t('lv.signalsEmpty'))); return; }
  const lines = new Map((s.transcript ?? []).map(l => [l.turnId, l]));
  for (const sig of signals) {
    const li = el('li', 'signal'); const line = sig.turnId ? lines.get(sig.turnId) : null;
    li.append(el('b', '', t('sig.' + sig.code)), el('span', 'weight', `+${sig.weight}`));
    if (line) li.append(el('time', '', fmt(line.startMediaMs)));
    if (sig.evidence) li.append(el('q', '', sig.evidence));
    list.append(li);
  }
}
function renderMeta(s) {
  const meta = s?.metaReview ?? {}, review = meta.review, body = $('meta-body');
  const status = review?.provider === 'LOCAL_CONTRACT_SIMULATOR' && meta.status === 'LIVE_VERIFIED' ? 'SIMULATED' : meta.status ?? 'DISABLED';
  text('meta-status', t('m.st.' + status) === 'm.st.' + status ? status : t('m.st.' + status)); $('meta-status').dataset.state = status;
  $('meta-card').dataset.prov = review?.provider === 'LOCAL_CONTRACT_SIMULATOR' ? 'LOCAL_CONTRACT_SIMULATOR' : 'MODEL_VERIFIED';
  body.replaceChildren();
  const max = s?.modelReadiness?.maxCallsPerRun ?? '—';
  if (!review) {
    if(media()?.replay){body.append(el('p','note',getLang()==='ko'?'촬영용 오프라인 규칙 리플레이. Meta 모델 판단이 아닙니다.':'Offline scripted replay. Risk comes from the local rules engine, not Meta AI.'));return;}
    body.append(el('p', 'empty', meta.errorCode ? t('lv.err', {code: meta.errorCode}) : t('lv.meta.empty')));
    if (meta.callCount) body.append(el('p', 'note faint', t('lv.meta.calls', {n: meta.callCount, max})));
    return;
  }
  if (review.provider === 'LOCAL_CONTRACT_SIMULATOR') body.append(el('p', 'tag warn block', t('lv.meta.sim')));
  const level = el('p', 'meta-level'); level.append(el('span', '', t('lv.meta.level')), el('b', '', review.riskLevel)); level.dataset.band = review.riskLevel; body.append(level);
  if (!review.accepted) body.append(el('p', 'tag warn block', t('lv.meta.notAccepted')));
  if (review.emergencyFlag) body.append(el('p', 'tag danger block', t('lv.meta.emergency')));
  if (review.evidenceTurnIds?.length) {
    const wrap = el('div', 'chips'); wrap.append(el('span', 'label', t('lv.meta.evidence')));
    const lines = new Map((s.transcript ?? []).map(l => [l.turnId, l]));
    for (const id of review.evidenceTurnIds) {
      const line = lines.get(id), chip = el('button', 'chip', line ? fmt(line.startMediaMs) : id); chip.type = 'button';
      chip.addEventListener('click', () => { const target = $('transcript').querySelector(`[data-turn="${CSS.escape(id)}"]`); target?.scrollIntoView({block: 'center', behavior: 'smooth'}); target?.classList.add('flash'); setTimeout(() => target?.classList.remove('flash'), 1600); });
      wrap.append(chip);
    }
    body.append(wrap);
  }
  if (review.uncertainty) { const u = el('p', 'uncertainty'); u.append(el('span', 'label', t('lv.meta.uncertainty')), el('span', '', review.uncertainty)); body.append(u); }
  if (review.advisories?.length) { const ul = el('ul', 'advice'); for (const a of review.advisories) ul.append(el('li', '', tServer(a))); const h = el('span', 'label', t('lv.meta.actions')); body.append(h, ul); }
  const newest = (s.transcript ?? []).find(l => l.turnId === review.newestTurnId);
  const foot = [t('lv.meta.calls', {n: meta.callCount, max}), `${t('lv.meta.trigger')}: ${t('trig.' + review.trigger)}`,
    newest ? t('lv.meta.coverage', {time: fmt(newest.endMediaMs)}) : null, review.elapsedMs != null ? `${review.elapsedMs} ms` : null,
    review.usage?.totalTokens != null ? `${review.usage.totalTokens} tok` : null, meta.errorCode ? t('lv.err', {code: meta.errorCode}) : null].filter(Boolean).join(' · ');
  body.append(el('p', 'note faint', foot));
}
function renderHud() {
  const h = S.hud;
  text('hud-sev', h ? t('hud.' + (h.severity === 'CLOSED' ? 'closed' : h.severity.toLowerCase())) : '—'); $('hud-sev').dataset.band = h?.severity ?? 'LOW';
  text('hud-title', h ? tServer(h.headline) : '—'); text('hud-copy', h ? tServer(h.guidance) : '');
  const cues = $('hud-cues'); cues.replaceChildren(); for (const c of h?.cues ?? []) cues.append(el('li', '', tServer(c)));
}
function zoneKey(zone) { return zone === 'AT_BANK' ? 'zone.at' : zone === 'NEAR_BANK' ? 'zone.near' : zone === 'AWAY' ? 'zone.move' : 'zone.wait'; }
function renderMap(s, m) {
  const loc = s?.location, step = Number.isInteger(loc?.step) ? loc.step : -1, index = Math.max(0, Math.min(ROUTE.length - 1, step));
  $('route-base').setAttribute('points', ROUTE.map(p => p.join(',')).join(' '));
  $('route-progress').setAttribute('points', step < 0 ? '' : ROUTE.slice(0, index + 1).map(p => p.join(',')).join(' '));
  $('you-pin').setAttribute('transform', `translate(${ROUTE[index][0]} ${ROUTE[index][1]})`);
  text('zone-name', t(zoneKey(step < 0 ? null : loc.zone))); text('distance', step < 0 ? '—' : `${loc.distanceMeters} m`);
  text('geo-state', step < 0 ? t('geo.wait') : loc.zone === 'AT_BANK' ? t('geo.at') : loc.zone === 'NEAR_BANK' ? t('geo.near') : t('geo.move'));
  const gps = m?.gps;
  text('gps-next', !gps ? '' : gps.nextStep >= gps.scheduleMs.length ? t('lv.gpsDone') : t('lv.gpsNext', {time: fmt(gps.scheduleMs[gps.nextStep])}));
}
function renderBank(s) {
  const gate = !!s?.protectionGate?.blocked;
  text('bank-flag', gate ? 'HOLD' : '—'); $('bank-flag').dataset.band = gate ? 'HIGH' : 'LOW';
  text('gate-status', t(gate ? 'lv.hold.on' : 'lv.hold.off')); $('gate-status').classList.toggle('on', gate);
  $('transfer').disabled = !s || !!s.endedAt; $('transfer').classList.toggle('blocked', gate);
  text('bank-result', !S.bank ? '' : S.bank.ok ? t('lv.sent') : S.bank.code === 'POLICY_DENIED' ? t('lv.denied') : t('lv.err', {code: S.bank.code}));
}
function renderMonitor(m) {
  const lat = $('latency'), cost = $('cost'); lat.replaceChildren(); cost.replaceChildren();
  const row = (dl, label, value) => { const d = el('div'); d.append(el('dt', '', label), el('dd', '', value)); dl.append(d); };
  const ms = st => st?.count ? `p50 ${st.p50} · p95 ${st.p95} · max ${st.max} ms (n=${st.count})` : '—';
  for (const key of ['audioSentToFinalMs', 'finalToRiskMs', 'finalToModelMs', 'modelElapsedMs']) row(lat, t('lat.' + key), ms(m?.latency?.[key]));
  row(cost, t('lv.cost.audio'), m ? `${(m.cost.sentMs / 1000).toFixed(1)} s / ${(m.cost.caps.audioMsPerRun / 1000).toFixed(0)} s` : '—');
  row(cost, t('lv.cost.silence'), m ? `${(m.cost.silenceMs / 1000).toFixed(1)} s` : '—');
  row(cost, t('lv.cost.usd'), m ? `$${m.cost.estimatedAsrUsd.toFixed(4)}${m.provider === 'META' ? '' : ' (' + t('prov.LOCAL_CONTRACT_SIMULATOR') + ')'}` : '—');
  row(cost, t('lv.cost.spark'), m ? `${m.cost.sparkCalls} · ${m.cost.sparkInputTokens + m.cost.sparkOutputTokens}` : '—');
}

/* ---------- wiring ---------- */
$('answer').addEventListener('click', () => void answer());
$('pause').addEventListener('click', togglePause);
$('stop').addEventListener('click', () => void endCall());
$('mute').addEventListener('click', () => { S.muted = !S.muted; video.muted = S.muted; schedule(); });
$('reset').addEventListener('click', () => void init());
$('transfer').addEventListener('click', () => void tryTransfer());
$('modal-dismiss').addEventListener('click', closeModal);
$('safety-modal').addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); if (e.key === 'Escape') closeModal(); } });
$('media-select').addEventListener('change', () => { S.mediaPicked = true; loadVideo(); schedule(); });
for(const [id,mode] of [['mode-replay','replay'],['mode-live','live']]) $(id).addEventListener('click',()=>{if(S.phase!=='idle')return;S.mode=mode;S.mediaPicked=true;const choices=S.catalog?.cases??[];const target=mode==='replay'?choices.find(c=>c.replayAvailable):choices.find(c=>c.kind==='SYNTHETIC_TTS');if(target){$('media-select').value=target.id;loadVideo();}schedule();});
$('shuffle-scenario').addEventListener('click',()=>{if(S.phase!=='idle')return;const eligible=(S.catalog?.cases??[]).filter(c=>S.mode!=='replay'||c.replayAvailable);if(!eligible.length)return;const current=selectedMedia(),other=eligible.filter(c=>c.id!==current);const next=(other.length?other:eligible)[Math.floor(Math.random()*(other.length||eligible.length))];$('media-select').value=next.id;S.mediaPicked=true;loadVideo();schedule();});
for (const id of ['rights', 'consent']) $(id).addEventListener('change', schedule);
$('open-hud').addEventListener('click', () => { if (!S.auth) return; window.open(`/glasses#session=${encodeURIComponent(S.auth.sessionId)}&token=${encodeURIComponent(S.auth.glassesToken)}`, '_blank', 'noopener,noreferrer'); });
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || !$('safety-modal').hidden) return;
  if (e.key === 'k' || (e.key === ' ' && e.target === document.body)) { e.preventDefault(); if (S.phase === 'idle') void answer(); else togglePause(); }
});
onLang(() => { S.transcriptKey = ''; schedule(); if (S.modal) text('modal-copy', t(S.modal)); });
setInterval(() => { if (S.auth) void request('/api/state').then(accept).catch(() => setConn('conn.retry')); }, 4000);
setInterval(() => text('phone-clock', new Date().toLocaleTimeString(locale(), {hour: '2-digit', minute: '2-digit'})), 10000);
void loadReadiness();
void init();
