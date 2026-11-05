/**
 * Shared HTTP boundaries for the local MOCK demo.
 * Rejects oversize bodies before buffering them; never handles external calls.
 */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || defaultErrorCode(status);
  }
}
/** Stable machine-readable error codes (v1.23). `error` stays human-readable for compat. */
export function defaultErrorCode(status) {
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'VALIDATION_ERROR';
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 409) return 'CASE_VERSION_CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}

export function assertSameOrigin(req, message = '출처 불일치') {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    throw new HttpError(403, message);
  }
}

export function requireJsonContentType(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'JSON 요청만 허용');
  }
}

/** The stream is consumed once, with a strict byte limit (not JS string length). */
export async function readBoundedBody(req, {maxBytes = 8192} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('invalid body size limit');
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new HttpError(413, '요청 크기 초과');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export async function readJsonObject(req, {maxBytes = 8192} = {}) {
  const buffer = await readBoundedBody(req, {maxBytes});
  let body;
  try {
    body = JSON.parse(buffer.length ? buffer.toString('utf8') : '{}');
  } catch {
    throw new HttpError(400, 'JSON 형식 오류');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '본문 객체가 필요합니다.');
  }
  return body;
}
