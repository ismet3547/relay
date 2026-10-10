import { randomUUID } from "node:crypto";
import { CallSession, DemoEvent, DemoState, Json, Stage } from "../lib/types";
import { FlowCancelled } from "./errors";
import { mutate } from "./store";

export const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const now = () => new Date().toISOString();
export function liveCall(state: DemoState, callId: string): CallSession {
  const call = state.calls.find(c => c.id === callId);
  if (!call || call.phase === "done") throw new FlowCancelled("Call ended or reset");
  return call;
}
export function event(state: DemoState, callId: string, stage: Stage, type: string, label: string, metadata: Json = {}, severity: DemoEvent["severity"] = "info") {
  state.events.push({ id: id("EV"), callId, stage, type, label, metadata, severity, at: now() });
}
export async function waitStep() {
  const value = Number(process.env.DEMO_STEP_MS ?? 320);
  const ms = Number.isFinite(value) ? Math.max(0, Math.min(value, 2000)) : 320;
  if (ms) await new Promise(resolve => setTimeout(resolve, ms));
}
export async function stage(callId: string, name: Stage, label: string, type: string, metadata: Json = {}) {
  mutate(state => {
    const call = liveCall(state, callId);
    call.activeStage = name;
    const status = name === "response" ? "responding" : name === "backend_action" ? "executing" : name === "verification" || name === "tool_selection" ? "checking" : "understanding";
    if (name !== "evaluation") call.status = status;
    const step = call.pipeline[name];
    step.status = "running"; step.count += 1; step.detail = label; step.updatedAt = now();
    event(state, callId, name, type, label, metadata);
  });
  await waitStep();
  mutate(state => { const call = liveCall(state, callId); call.pipeline[name].status = "complete" });
}
