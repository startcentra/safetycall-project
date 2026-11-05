/** Server-only config; never expose API key in status response or client bundle. */
export const MODEL_NAME = "muse-spark-1.3";
export function getMetaSettings(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.MODEL_API_KEY ?? "").trim().length > 0;
  const enabled = env.META_LIVE_ENABLED === "true";
  const rawLimit = Number.parseInt(env.META_MAX_REQUESTS_PER_RUN ?? "5", 10);
  const maxCalls = Number.isInteger(rawLimit) && rawLimit >= 0 ? Math.min(5, rawLimit) : 5;
  return { configured, enabled, maxCalls, model: MODEL_NAME };
}

/** A server-owned bound. Never accept a token ceiling from browser input. */
export function getSparkOutputCap(env:NodeJS.ProcessEnv=process.env):number {
 const raw=env.META_MAX_OUTPUT_TOKENS ?? '1200';
 if(!/^[0-9]+$/.test(raw))return 0;
 const n=Number(raw);
 return Number.isSafeInteger(n)&&n>=128&&n<=1200?n:0;
}
