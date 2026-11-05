'use strict';
import {acceptHudSnapshot, hudRetryDelay} from './glasses-policy.js';
import {onLang, setLang, t, tServer} from './i18n.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'safecall-glasses-v141';
const LEGACY_KEY = 'safecall-glasses-v140';
const POLL_MS = 2500;
const META_LABEL = {
  META_LIVE_VERIFIED: 'g.meta',
  META_ANALYSIS_PENDING: 'meta.analyzing',
  META_UNAVAILABLE: 'meta.brand',
  OFFLINE_SCRIPTED_MOCK: 'meta.brand',
};
let lastState = null;
let lastConn = 'WAIT';

let auth = null;
let generation = 0;
let abort = null;
let retryTimer = null;
let pollTimer = null;
let loopActive = false;
let authStopped = false;
let memory = {runId: null, version: -1};
let sseFailures = 0;
let polling = false;

function connectionText(value) {
  lastConn = value || 'WAIT';
  const el = $('hud-connection');
  el.dataset.state = lastConn;
  const known = lastConn === 'CONNECTED' || lastConn === 'RECONNECTING' || lastConn === 'EXPIRED' ? lastConn : 'WAIT';
  el.textContent = t('g.conn.' + known);
  $('side-connect').textContent = t('g.side.' + known);
}

function validAuth(value) {
  return !!(value && /^session_[a-z0-9]{20}$/.test(value.session) && /^[A-Za-z0-9_-]{20,256}$/.test(value.token));
}

function readStored() {
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    try {
      const old = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (validAuth(old)) return old;
    } catch { /* ignore unreadable session storage */ }
  }
  return null;
}

function clearStored() {
  try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(LEGACY_KEY); } catch { /* private mode */ }
}

function parseAuth() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const session = params.get('session');
  const token = params.get('token');
  if (session || token) history.replaceState(null, '', location.pathname + location.search);
  if (session && token) return validAuth({session, token}) ? {session, token} : null;
  return readStored();
}

function render(state) {
  const level = ['LOW', 'CAUTION', 'HIGH', 'CLOSED'].includes(state.severity) ? state.severity : 'LOW';
  const lens = $('lens');
  lens.dataset.severity = level;
  lens.dataset.meta = state.metaDisplay || 'OFFLINE_SCRIPTED_MOCK';
  const wear = $('wear');
  if (wear) { wear.dataset.place = level === 'HIGH' ? 'bank' : 'street'; wear.dataset.severity = level; }
  const note = $('scene-note');
  if (note) note.textContent = t(level === 'HIGH' ? 'g.scene.bank' : level === 'CLOSED' ? 'g.scene.done' : 'g.scene.street');
  $('orbit-core').textContent = level === 'HIGH' || level === 'CAUTION' ? '!' : '✓';
  lastState = state;
  $('hud-tag').textContent = t(level === 'HIGH' ? 'g.tag.HIGH' : level === 'CAUTION' ? 'g.tag.CAUTION' : level === 'CLOSED' ? 'g.tag.CLOSED' : 'g.tag.LOW');
  $('hud-title').textContent = tServer(typeof state.headline === 'string' ? state.headline : '상태 확인 중');
  $('hud-message').textContent = tServer(typeof state.guidance === 'string' ? state.guidance : '휴대폰과 연결되면 안내가 여기에 표시됩니다.');
  $('hud-risk').textContent = t(level === 'HIGH' ? 'hud.high' : level === 'CAUTION' ? 'hud.caution' : level === 'CLOSED' ? 'hud.closed' : 'hud.low');
  $('hud-meta').textContent = t(META_LABEL[state.metaDisplay] || META_LABEL.OFFLINE_SCRIPTED_MOCK);
  $('hud-bar-fill').style.width = level === 'HIGH' ? '95%' : level === 'CAUTION' ? '58%' : level === 'CLOSED' ? '0%' : '13%';
  $('hud-disclaimer').textContent = level === 'HIGH' || level === 'CAUTION' ? t('g.disclaimer') : '';
  $('side-run').textContent = state.runId ? state.runId.slice(-8) : '—';
  $('side-version').textContent = String(state.version) + ' · ' + String(state.step || 0);
  $('side-provider').textContent = state.metaDisplay === 'META_LIVE_VERIFIED' ? 'Meta · SAFETYED' : state.metaDisplay === 'META_ANALYSIS_PENDING' ? t('g.pending') : 'SAFETYED';
  const cues = $('hud-cues');
  cues.replaceChildren();
  const items = Array.isArray(state.cues) ? state.cues.slice(0, 3) : [];
  for (const cue of items) {
    if (typeof cue !== 'string' || !cue) continue;
    const li = document.createElement('li');
    li.textContent = tServer(cue);
    cues.appendChild(li);
  }
  cues.hidden = cues.childElementCount === 0;
}

function authHeaders() {
  return {'X-SafeCall-Session': auth.session, 'X-SafeCall-Token': auth.token};
}

function clearTimers() {
  clearTimeout(retryTimer);
  clearTimeout(pollTimer);
  retryTimer = null;
  pollTimer = null;
}

function failAuth() {
  authStopped = true;
  auth = null;
  clearStored();
  clearTimers();
  if (abort) abort.abort();
  connectionText('EXPIRED');
  $('hud-title').textContent = t('g.sessionEnd');
  $('hud-message').textContent = t('g.sessionEndCopy');
  $('hud-cues').replaceChildren();
  $('hud-cues').hidden = true;
}

function applyIncoming(state, source) {
  const decision = acceptHudSnapshot(memory, state, source);
  memory = decision.memory;
  if (!decision.accept) return decision;
  render(state);
  connectionText('CONNECTED');
  return decision;
}

async function pullState(signal) {
  const response = await fetch('/api/glasses/state', {headers: authHeaders(), cache: 'no-store', credentials: 'same-origin', signal});
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error('auth'), {expired: true});
  if (!response.ok) throw new Error('server');
  return applyIncoming(await response.json(), 'state');
}

function schedulePoll(gen) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => { void pollOnce(gen); }, POLL_MS);
}

async function pollOnce(gen) {
  if (gen !== generation || authStopped) return;
  try {
    await pullState(abort?.signal);
  } catch (error) {
    if (gen !== generation || abort?.signal?.aborted) return;
    if (error?.expired) { failAuth(); return; }
    connectionText('RECONNECTING');
  }
  if (gen === generation && !authStopped && polling) schedulePoll(gen);
}

function startPolling(gen) {
  if (polling) return;
  polling = true;
  schedulePoll(gen);
}

function stopPolling() {
  polling = false;
  clearTimeout(pollTimer);
  pollTimer = null;
}

async function readSse(response, signal, gen) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal.aborted && gen === generation) {
      const {done, value} = await reader.read();
      if (done) return;
      pending += decoder.decode(value, {stream: true}).replaceAll('\r\n', '\n');
      if (pending.length > 32_768) throw new Error('HUD SSE event too large');
      let pos;
      while ((pos = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, pos);
        pending = pending.slice(pos + 2);
        if (!frame.startsWith('event: state\n')) continue;
        const raw = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (!raw) continue;
        try {
          const decision = applyIncoming(JSON.parse(raw), 'sse');
          if (decision.reason === 'foreign-run') void pullState(signal).catch(error => { if (error?.expired) failAuth(); });
        } catch (error) {
          if (error?.expired) throw error;
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* already closed */ }
  }
}

function sleep(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(retryTimer); signal.removeEventListener('abort', finish); resolve(); };
    retryTimer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, {once: true});
  });
}

function begin(force = false) {
  if (authStopped && !force) return;
  if (loopActive && !force) return;
  generation += 1;
  const gen = generation;
  if (abort) abort.abort();
  abort = new AbortController();
  clearTimers();
  polling = false;
  loopActive = true;
  authStopped = false;
  const signal = abort.signal;
  void runLoop(gen, signal);
}

async function runLoop(gen, signal) {
  try {
    if (!auth) {
      connectionText('EXPIRED');
      $('hud-title').textContent = t('g.noLink');
      $('hud-message').textContent = t('g.noLinkCopy');
      authStopped = true;
      return;
    }
    let attempt = 0;
    while (gen === generation && !signal.aborted && !authStopped) {
      try {
        await pullState(signal);
        const response = await fetch('/api/glasses/events', {headers: authHeaders(), cache: 'no-store', credentials: 'same-origin', signal});
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error('auth'), {expired: true});
        if (!response.ok || !response.body) throw new Error('SSE unavailable');
        connectionText('CONNECTED');
        attempt = 0;
        sseFailures = 0;
        stopPolling();
        await readSse(response, signal, gen);
        if (signal.aborted || gen !== generation || authStopped) return;
        throw new Error('SSE closed');
      } catch (error) {
        if (signal.aborted || gen !== generation) return;
        if (error?.expired) { failAuth(); return; }
        sseFailures += 1;
        connectionText('RECONNECTING');
        if (sseFailures >= 2) startPolling(gen);
        await sleep(hudRetryDelay(attempt), signal);
        attempt += 1;
      }
    }
  } finally {
    if (gen === generation) loopActive = false;
  }
}

function init() {
  auth = parseAuth();
  if (auth) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      sessionStorage.removeItem(LEGACY_KEY);
    } catch { /* private mode */ }
  }
  $('retry').addEventListener('click', () => {
    if (!auth) {
      auth = readStored();
    }
    if (!auth) {
      $('hud-message').textContent = t('g.retryCopy');
      connectionText('EXPIRED');
      return;
    }
    authStopped = false;
    begin(true);
  });
  document.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) || event.repeat) return;
    const lens = $('lens');
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') lens.classList.remove('detail-view');
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') lens.classList.add('detail-view');
    else lens.classList.toggle('detail-view');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !auth || authStopped) return;
    void pullState(abort?.signal).catch(error => {
      if (error?.expired) failAuth();
      else if (!loopActive) begin(true);
    });
  });
  window.addEventListener('online', () => { if (auth && !authStopped) begin(true); });
  begin(false);
  onLang(() => { connectionText(lastConn); if (lastState) render(lastState); else { const note = $('scene-note'); if (note) note.textContent = t('g.scene.street'); } });
  window.addEventListener('storage', event => {
    if (event.key === 'safeteyed-lang' && (event.newValue === 'en' || event.newValue === 'ko')) setLang(event.newValue);
  });
}

init();
