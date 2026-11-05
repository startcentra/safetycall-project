export const APP_PHASE = "M2_SKELETON" as const;
export const MODEL_STATUS = "not_connected" as const;
export const CURRENT_MODE = "demo_skeleton" as const;
export const healthSnapshot = () => ({
  status: "ok" as const,
  service: "safecall-guardian",
  phase: APP_PHASE,
  model: MODEL_STATUS,
  mode: CURRENT_MODE,
  version: "0.2.0",
  timestamp: new Date().toISOString(),
});
