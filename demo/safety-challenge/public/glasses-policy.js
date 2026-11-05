/** Shared HUD admission rules. SSE from an older runId must not replace the confirmed case. */
export function acceptHudSnapshot(memory, incoming, source) {
  const current = memory && typeof memory === 'object' ? memory : {runId: null, version: -1};
  if (!incoming || incoming.demoOnly !== true || incoming.readOnly !== true) return {memory: current, accept: false, reason: 'invalid'};
  if (typeof incoming.runId !== 'string' || incoming.runId.length < 1 || incoming.runId.length > 64) return {memory: current, accept: false, reason: 'run'};
  if (!Number.isSafeInteger(incoming.version) || incoming.version < 0) return {memory: current, accept: false, reason: 'version'};
  const same = current.runId === incoming.runId;
  if (source === 'sse' && current.runId && !same) return {memory: current, accept: false, reason: 'foreign-run'};
  if (same && incoming.version < current.version) return {memory: current, accept: false, reason: 'stale-version'};
  return {memory: {runId: incoming.runId, version: incoming.version}, accept: true, reason: 'ok'};
}

export const HUD_BACKOFF_CAP_MS = 8000;
export function hudRetryDelay(attempt) {
  const n = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(HUD_BACKOFF_CAP_MS, 400 * (2 ** Math.min(n, 5)));
}
