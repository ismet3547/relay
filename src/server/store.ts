import fs from "node:fs";
import path from "node:path";
import { DemoState } from "../lib/types";
import { seedState } from "./seed";

type Listener = (state: DemoState) => void;
type Runtime = { state: DemoState; listeners: Set<Listener>; file: string };
const globals = globalThis as typeof globalThis & { __relayDemo?: Runtime };

function runtime(): Runtime {
  if (globals.__relayDemo) return globals.__relayDemo;
  const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), ".demo-data");
  const file = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });
  let state: DemoState;
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as DemoState;
    if (state.version !== 1) throw new Error("Unsupported demo data version. Back up and remove .demo-data to reseed.");
    // A process restart cannot continue an in-flight workflow. Keep any committed booking.
    for (const call of state.calls) {
      if (call.source === "session" && !call.endedAt) {
        const booking = state.appointments.find(a => a.callId === call.id);
        call.status = booking ? "completed" : "ended";
        call.phase = "done"; call.processing = false; call.activeStage = null;
        call.endedAt = new Date().toISOString();
        call.durationSeconds = Math.floor((Date.now() - Date.parse(call.startedAt)) / 1000);
        call.bookingId = booking?.id;
        call.issues.push("The local server restarted during this call.");
        call.evaluation = { intent: call.intent, outcome: booking ? "booked" : "cancelled", taskCompleted: !!booking, humanRequired: false, toolsSucceeded: state.tools.filter(t => t.callId === call.id && t.status === "success").length, toolsFailed: state.tools.filter(t => t.callId === call.id && t.status === "failure").length, issues: [...call.issues], suggestion: "Replay the interrupted call. Committed appointments were preserved." };
      }
    }
    for (const tool of state.tools) if (tool.status === "running") {
      tool.status = "failure"; tool.completedAt = new Date().toISOString(); tool.result = { code: "SERVER_RESTARTED", error: "Execution interrupted by a local restart." };
    }
  } else state = seedState();
  globals.__relayDemo = { state, listeners: new Set(), file };
  persist(globals.__relayDemo);
  return globals.__relayDemo;
}
function persist(rt: Runtime) {
  // All mutations are synchronous in one Node process. The atomic rename prevents partial files.
  const temporary = rt.file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(rt.state, null, 2));
  fs.renameSync(temporary, rt.file);
}
export function snapshot(): DemoState { return structuredClone(runtime().state) }
export function mutate<T>(fn: (state: DemoState) => T): T {
  const rt = runtime();
  const next = structuredClone(rt.state);
  const result = fn(next);
  next.revision += 1;
  const previous = rt.state;
  rt.state = next;
  try { persist(rt) } catch (error) { rt.state = previous; throw error }
  for (const listener of rt.listeners) { try { listener(structuredClone(next)) } catch { rt.listeners.delete(listener) } }
  return result;
}
export function resetState() { mutate(state => Object.assign(state, seedState(state.revision))) }
export function subscribe(listener: Listener) { const rt = runtime(); rt.listeners.add(listener); return () => { rt.listeners.delete(listener) } }
