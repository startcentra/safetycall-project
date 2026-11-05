/* SafeCall v1.22 — same-origin JSON client; exported for offline tests.
   No persistence, tokens or Meta API access here. Financial commands are never retried.
   v1.22: deep runtime schema, request-id, retryable classification, transfer-input
   validation and PII-free structured log events. Server remains the only authority. */
export const BUILD_VERSION = '1.25.0';

export class ApiError extends Error {
  constructor(code, message, status = 0, { retryable = false, requestId = null } = {}) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status;
    this.retryable = retryable; this.requestId = requestId;
  }
}
export function classifyHttp(status) {
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 409) return 'VERSION_CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}
const RETRYABLE = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED']);
export function isRetryableCode(code) { return RETRYABLE.has(code); }
/** v1.23: trusted server machine-readable codes take priority over raw HTTP status.
    Unknown/absent codes fall back to classifyHttp() for backward compatibility. */
export const SERVER_ERROR_CODES = new Set(['CASE_VERSION_CONFLICT', 'POLICY_DENIED', 'COMMAND_REPLAY_CONFLICT', 'CASE_ENDED', 'EMERGENCY_LOCK', 'PROXIMITY_LOCK', 'VALIDATION_ERROR', 'AUTH_REQUIRED', 'FORBIDDEN', 'RATE_LIMITED', 'SERVER_ERROR']);
export function resolveErrorCode(status, serverCode) {
  return SERVER_ERROR_CODES.has(serverCode) ? serverCode : classifyHttp(status);
}

export function createRequestId() {
  try { if (globalThis.crypto?.randomUUID) return 'req_' + globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16); } catch { /* fallback */ }
  return 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, min = 0, max = 4096) => typeof v === 'string' && v.length >= min && v.length <= max;
const isInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isNum = (v, min = 0, max = 100) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Deep runtime schema for a server-approved case snapshot (v1.22 hardened). */
export function isCaseState(s) {
  if (!isObj(s)) return false;
  if (!isStr(s.runId, 1, 128) || !isInt(s.version) || !isInt(s.careCaseVersion)) return false;
  if (!isInt(s.step, 0, 10000) || !isStr(s.mode, 1, 40)) return false;
  if (!(s.endedAt === null || isStr(s.endedAt, 1, 64))) return false;
  if (!isObj(s.scenario) || !isStr(s.scenario.id, 1, 64) || !isInt(s.scenario.totalSteps, 0, 10000)) return false;
  if (!isObj(s.risk) || !['LOW', 'CAUTION', 'HIGH'].includes(s.risk.band)) return false;
  if (!isNum(s.risk.index) || !isNum(s.risk.urgency, 0, 1000) || !isNum(s.risk.pressure, 0, 1000)
    || !isNum(s.risk.proximity, 0, 1000) || !isInt(s.risk.evidence, 0, 10000)) return false;
  if (typeof s.risk.emergency !== 'boolean') return false;
  if (!Array.isArray(s.transcript) || s.transcript.length > 500) return false;
  for (const t of s.transcript) {
    if (!isObj(t) || !isStr(t.turnId, 1, 128) || !isStr(t.text, 0, 4000)) return false;
    if (t.cue !== undefined && !isStr(t.cue, 0, 1000)) return false;
  }
  if (!Array.isArray(s.log) || s.log.length > 500) return false;
  for (const e of s.log) {
    if (!isObj(e) || !isStr(e.type, 1, 128) || !isStr(e.message, 0, 2000)) return false;
  }
  if (s.mockCard !== undefined && (!isObj(s.mockCard) || s.mockCard.caseId !== s.runId || s.mockCard.cardRef !== 'DEMO_CARD_1' ||
    !['ACTIVE','LOCKED'].includes(s.mockCard.status) || !isInt(s.mockCard.revision) || !Array.isArray(s.mockCard.activity))) return false;
  if (s.toolProposals !== undefined && (!Array.isArray(s.toolProposals) || s.toolProposals.length > 20)) return false;
  if (!isObj(s.safeBank)) return false;
  const b = s.safeBank;
  if (!isStr(b.caseId, 1, 128) || b.caseId !== s.runId) return false;
  if (!isInt(b.caseVersion) || !isInt(b.revision) || !['READY', 'HELD', 'CANCELLED'].includes(b.status)) return false;
  if (!Array.isArray(b.activity) || b.activity.length > 500) return false;
  for (const a of b.activity) {
    if (!isObj(a) || !['HOLD', 'CANCEL'].includes(a.kind) || !isInt(a.revision)) return false;
  }
  if (b.processedIds !== undefined && (!Array.isArray(b.processedIds) || !b.processedIds.every((x) => isStr(x, 1, 128)))) return false;
  if (typeof s.bankArrivalConfirmed !== 'boolean' || typeof s.bankHelpConsented !== 'boolean') return false;
  if (!(s.bankArrivalVersion === null || isInt(s.bankArrivalVersion))) return false;
  if (!Array.isArray(s.actions) || s.actions.length > 1000) return false;
  if (!isObj(s.review)) return false;
  return true;
}

/** Local-only SafeBank form validation. Recipient/amount are NEVER sent to the server:
    the demo API only records a SIMULATED_TRANSFER attempt. Validating here prevents
    claiming the server received inputs it does not accept. */
export function validateTransferInput({ recipient, amount, balance = 1240000 } = {}) {
  const errors = {};
  const name = String(recipient ?? '').trim();
  if (name.length < 2) errors.recipient = '받는 사람을 2자 이상 입력하세요.';
  else if (name.length > 20) errors.recipient = '받는 사람은 20자 이내로 입력하세요.';
  else if (/[<>{}[\]\\]/.test(name)) errors.recipient = '받는 사람에 사용할 수 없는 문자가 있습니다.';
  else if (/^\d+$/.test(name)) errors.recipient = '받는 사람 이름(허구)을 입력하세요. 숫자만은 사용할 수 없습니다.';
  const raw = String(amount ?? '').replace(/[,\s원]/g, '');
  if (!/^\d+$/.test(raw)) errors.amount = '금액은 숫자만 입력하세요.';
  else {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1000) errors.amount = '금액은 1,000원 이상 입력하세요.';
    else if (value > balance) errors.amount = '가상 잔액(₩1,240,000)을 초과할 수 없습니다.';
    else if (value % 10 !== 0) errors.amount = '금액은 10원 단위로 입력하세요.';
  }
  return { ok: Object.keys(errors).length === 0, errors, value: { recipient: name, amount: /^\d+$/.test(raw) ? Number(raw) : null } };
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
/** PII-free structured log event. Only allow-listed fields survive; transcript text,
    tokens, coordinates, account data and free-form messages are dropped by design. */
export function createLogEvent(fields = {}) {
  const pick = (k, ok) => (ok(fields[k]) ? fields[k] : undefined);
  const event = {
    timestamp: new Date().toISOString(),
    level: LOG_LEVELS.has(fields.level) ? fields.level : 'info',
    component: pick('component', (v) => isStr(v, 1, 48)) || 'mobile',
    eventType: pick('eventType', (v) => isStr(v, 1, 64)) || 'unknown',
    buildVersion: BUILD_VERSION,
  };
  const opt = (k, v) => { if (v !== undefined) event[k] = v; };
  opt('requestId', pick('requestId', (v) => isStr(v, 1, 64)));
  opt('caseVersion', pick('caseVersion', (v) => isInt(v)));
  opt('commandType', pick('commandType', (v) => isStr(v, 1, 48)));
  opt('durationMs', pick('durationMs', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0));
  opt('errorCode', pick('errorCode', (v) => isStr(v, 1, 48)));
  opt('result', pick('result', (v) => ['ok', 'error', 'skipped', 'conflict'].includes(v)));
  opt('view', pick('view', (v) => isStr(v, 1, 24)));
  return event;
}

/** Timeout is cancellation, not confirmation that a server-side command was not applied. */
export async function requestJson(path, { method = 'GET', body, headers = {}, timeoutMs = 8000, fetchImpl = fetch, validate, requestId } = {}) {
  if (!/^\/api\/[a-z0-9/_-]+$/.test(path)) throw new ApiError('VALIDATION_ERROR', '허용되지 않은 API 경로입니다.');
  if (!['GET', 'POST'].includes(method)) throw new ApiError('VALIDATION_ERROR', '허용되지 않은 요청 방식입니다.');
  const rid = requestId || createRequestId();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(path, {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Request-Id': rid, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new ApiError('TIMEOUT', '서버 응답 시간이 초과되었습니다. 처리 여부를 확인하세요.', 0, { retryable: true, requestId: rid });
      if (error?.name === 'AbortError') throw new ApiError('ABORTED', '요청이 중단되었습니다.', 0, { requestId: rid });
      throw new ApiError('NETWORK_ERROR', '서버에 연결할 수 없습니다. 네트워크를 확인하세요.', 0, { retryable: true, requestId: rid });
    }
    let data;
    try {
      const contentType = response.headers?.get?.('content-type') || '';
      if (!/application\/json/i.test(contentType)) throw new Error('content type');
      data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not object');
    } catch {
      if (timedOut) throw new ApiError('TIMEOUT', '응답 처리 시간이 초과되었습니다. 서버 상태를 확인하세요.', response.status, { retryable: true, requestId: rid });
      throw new ApiError('INVALID_RESPONSE', '서버 응답 형식을 확인할 수 없습니다.', response.status, { requestId: rid });
    }
    if (!response.ok) {
      const fallback = `요청을 처리할 수 없습니다 (${response.status}).`;
      const message = typeof data.error === 'string' ? data.error.slice(0, 180) : fallback;
      const code = resolveErrorCode(response.status, data.code);
      throw new ApiError(code, message, response.status, { retryable: isRetryableCode(code), requestId: rid });
    }
    if (validate && !validate(data)) throw new ApiError('INVALID_RESPONSE', '서버 데이터 검증에 실패했습니다.', response.status, { requestId: rid });
    return data;
  } finally { clearTimeout(timeout); }
}
export function delayForRetry(attempt) { return Math.min(12000, 600 * (2 ** Math.min(attempt, 4))); }

/** Atomic local demo session handoff. Never discard the previous session if the
 * server rejects/never completes creation of its replacement. Cleanup is best-effort
 * and runs only AFTER the replacement is committed; no retry of create() occurs here.
 */
export async function replaceDemoSession({ create, commit, releasePrevious } = {}) {
  if (typeof create !== 'function' || typeof commit !== 'function')
    throw new ApiError('VALIDATION_ERROR', '세션 교체 함수가 누락되었습니다.');
  const next = await create();
  if (!isCaseState(next) || !next.sessionCredentials ||
      !isStr(next.sessionCredentials.sessionId, 1, 256) ||
      !isStr(next.sessionCredentials.parentToken, 1, 512))
    throw new ApiError('INVALID_RESPONSE', '새 세션 응답이 유효하지 않습니다. 기존 사건을 유지합니다.');
  commit(next);
  if (typeof releasePrevious === 'function') {
    try { await releasePrevious(); } catch { /* prior session expires naturally */ }
  }
  return next;
}
