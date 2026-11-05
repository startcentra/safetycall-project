import "server-only";
import { randomUUID } from "node:crypto";
import { applySimulationAction, startSimulation, type SimulationAction, type SimulationState } from "./engine";

const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 250;
type Stored = { state: SimulationState; touched: number };
const globalStore = globalThis as typeof globalThis & { __safecallSessions?: Map<string, Stored> };
const sessions = globalStore.__safecallSessions ?? (globalStore.__safecallSessions = new Map<string, Stored>());

function prune(now: number) {
  for (const [id, entry] of sessions) if (now - entry.touched > TTL_MS) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) {
    const first = sessions.keys().next().value;
    if (!first) break;
    sessions.delete(first);
  }
}

export function createDemoSession(): SimulationState {
  const now = Date.now();
  prune(now);
  const state = startSimulation(randomUUID(), new Date(now).toISOString());
  sessions.set(state.id, { state, touched: now });
  return state;
}

export function advanceDemoSession(id: string, action: SimulationAction): SimulationState {
  const entry = sessions.get(id);
  if (!entry || Date.now() - entry.touched > TTL_MS) {
    sessions.delete(id);
    throw new Error("세션이 없거나 만료됐습니다. 훈련을 다시 시작하세요.");
  }
  const next = applySimulationAction(entry.state, action, new Date().toISOString());
  sessions.set(id, { state: next, touched: Date.now() });
  return next;
}
