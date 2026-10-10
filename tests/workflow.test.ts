import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dateOffset } from "../src/lib/date";
import { DemoError } from "../src/server/errors";
import { body } from "../src/server/http";
import { endCall, getCall, startCall, submitInput } from "../src/server/orchestrator";
import { mutate, resetState, snapshot } from "../src/server/store";
import { dispatchTool } from "../src/server/tools";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
process.env.DEMO_DATA_DIR = directory;
process.env.DEMO_STEP_MS = "0";
let sequence = 0;
const send = (callId: string, text: string, messageId = `message-${String(++sequence).padStart(8, "0")}`) => submitInput(callId, { text, messageId });
beforeEach(() => { resetState(); process.env.DEMO_STEP_MS = "0" });
after(() => { fs.rmSync(directory, { recursive: true, force: true }) });
async function readyToConfirm() {
  const call = (await startCall("appointment"))!;
  await send(call.id, "I'd like an oil change tomorrow morning. My car is a 2021 Honda Civic.");
  await send(call.id, "10:00 AM, please.");
  return call.id;
}

test("asks for missing details and cannot write before explicit confirmation", async () => {
  const call = (await startCall("appointment"))!;
  assert.equal(call.processing, false);
  await send(call.id, "I'd like to book an oil change tomorrow morning.");
  assert.deepEqual(getCall(call.id).missingInfo, ["vehicle year, make and model"]);
  assert.equal(snapshot().tools.length, 0);
  await send(call.id, "My car is a 2021 Honda Civic.");
  assert.equal(getCall(call.id).phase, "slot");
  assert.deepEqual(getCall(call.id).availableSlots, ["10:00", "11:00"]);
  await send(call.id, "10:00 AM, please.");
  assert.equal(getCall(call.id).phase, "confirmation");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
  await send(call.id, "I'm thinking about it.");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
});
test("creates, persists, and verifies an actual appointment", async () => {
  const callId = await readyToConfirm();
  await send(callId, "Yes, please book it.");
  const state = snapshot(); const call = getCall(callId);
  assert.equal(call.status, "completed"); assert.equal(call.evaluation?.taskCompleted, true);
  const booking = state.appointments.find(a => a.callId === callId)!;
  assert.equal(booking.time, "10:00"); assert.equal(booking.vehicle, "2021 Honda Civic");
  assert.equal(call.bookingId, booking.id);
  assert.equal(state.tools.find(t => t.name === "lookup_booking")?.result?.verified, true);
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  assert.equal(persisted.appointments.find((a: { callId: string }) => a.callId === callId).id, booking.id);
  assert.ok(state.events.some(e => e.callId === callId && e.type === "booking_verified"));
  assert.equal(call.pipeline.verification.status, "complete"); assert.equal(call.pipeline.evaluation.status, "complete");
});
test("replayed customer confirmations never create a duplicate or repeat tools", async () => {
  const callId = await readyToConfirm(); const messageId = "confirmation-repeat-001";
  await send(callId, "Yes, please book it.", messageId);
  const count = snapshot().tools.length;
  await send(callId, "Yes, please book it.", messageId);
  assert.equal(snapshot().tools.length, count);
  assert.equal(snapshot().appointments.filter(a => a.callId === callId).length, 1);
});
test("concurrent duplicate confirmations remain idempotent", async () => {
  const callId = await readyToConfirm();
  await Promise.all([send(callId, "Yes, please book it.", "concurrent-confirmation-001"), send(callId, "Yes, please book it.", "concurrent-confirmation-001")]);
  assert.equal(snapshot().appointments.filter(a => a.callId === callId).length, 1);
  assert.equal(snapshot().tools.filter(t => t.callId === callId && t.name === "create_booking").length, 1);
});
test("the booking tool replays the same result and rejects changed idempotent arguments", async () => {
  const callId = await readyToConfirm(); await send(callId, "Yes, please book it.");
  const args = snapshot().tools.find(t => t.callId === callId && t.name === "create_booking")!.arguments;
  const replay = mutate(state => dispatchTool(state, callId, "create_booking", args));
  assert.equal(replay.replayed, true);
  assert.equal(snapshot().appointments.filter(a => a.callId === callId).length, 1);
  assert.throws(() => mutate(state => dispatchTool(state, callId, "create_booking", { ...args, time: "11:00" })), (e: unknown) => e instanceof DemoError && e.code === "IDEMPOTENCY_MISMATCH");
});
test("conflict rejects the occupied slot and accepts a user-selected alternative", async () => {
  const call = (await startCall("conflict"))!;
  await send(call.id, "An oil change tomorrow at 9:00 AM. My car is a 2020 Volvo XC60.");
  assert.equal(getCall(call.id).phase, "slot");
  assert.equal(snapshot().tools.at(-1)?.result?.requestedSlotAvailable, false);
  assert.ok(getCall(call.id).issues.some(i => i.includes("09:00")));
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
  await send(call.id, "11:00 AM, please."); await send(call.id, "Yes, please book it.");
  assert.equal(snapshot().appointments.find(a => a.callId === call.id)?.time, "11:00");
  assert.equal(getCall(call.id).evaluation?.taskCompleted, true);
});
test("conflict can be declined without creating an appointment", async () => {
  const call = (await startCall("conflict"))!;
  await send(call.id, "An oil change tomorrow at 9:00 AM. My car is a 2020 Volvo XC60.");
  await send(call.id, "No, please cancel.");
  assert.equal(getCall(call.id).status, "ended");
  assert.equal(getCall(call.id).evaluation?.outcome, "declined");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
});
test("an unsupported operation creates an actual local human handoff", async () => {
  const call = (await startCall("handoff"))!;
  await send(call.id, "Can you approve a warranty refund for my repair?");
  assert.equal(getCall(call.id).status, "escalated");
  assert.equal(snapshot().handoffs.length, 1);
  assert.equal(snapshot().handoffs[0].callId, call.id);
  assert.equal(getCall(call.id).evaluation?.humanRequired, true);
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
  assert.equal(snapshot().tools[0].name, "request_human_handoff");
});
test("unknown free text is safely escalated instead of inventing an operation", async () => {
  const call = (await startCall("appointment"))!;
  await send(call.id, "Can you sell me a spaceship?");
  assert.equal(getCall(call.id).status, "escalated");
  assert.equal(snapshot().handoffs[0].reason, "Can you sell me a spaceship?");
});
test("booking a different service is handed off instead of substituted with an oil change", async () => {
  const call = (await startCall("appointment"))!;
  await send(call.id, "I'd like to book a tire rotation tomorrow morning.");
  assert.equal(getCall(call.id).status, "escalated");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
  assert.equal(snapshot().handoffs[0].reason, "I'd like to book a tire rotation tomorrow morning.");
});
test("a changed date invalidates the prior confirmation and is checked again", async () => {
  const callId = await readyToConfirm();
  await send(callId, `Actually ${dateOffset(2)} at 10:00 AM, please.`);
  assert.equal(getCall(callId).entities.date, dateOffset(2));
  assert.equal(getCall(callId).phase, "confirmation");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
  await send(callId, "Yes, please book it.");
  assert.equal(snapshot().appointments.find(a => a.callId === callId)?.date, dateOffset(2));
});
test("a race for a slot fails safely and returns new alternatives", async () => {
  const callId = await readyToConfirm();
  mutate(state => { state.appointments.push({ ...state.appointments[0], id: "OTHER-BOOKING", time: "10:00" }) });
  await send(callId, "Yes, please book it.");
  assert.equal(getCall(callId).phase, "slot");
  assert.equal(snapshot().appointments.filter(a => a.callId === callId).length, 0);
  assert.equal(snapshot().tools.find(t => t.name === "create_booking")?.status, "failure");
  await send(callId, "11:00 AM, please."); await send(callId, "Yes, please book it.");
  assert.equal(getCall(callId).evaluation?.toolsFailed, 1);
  assert.equal(getCall(callId).evaluation?.taskCompleted, true);
});
test("paused intake and a single active call are enforced on the backend", async () => {
  mutate(state => { state.agentActive = false });
  await assert.rejects(startCall("appointment"), (e: unknown) => e instanceof DemoError && e.code === "AGENT_PAUSED");
  mutate(state => { state.agentActive = true });
  const call = (await startCall("appointment"))!;
  await assert.rejects(startCall("conflict"), (e: unknown) => e instanceof DemoError && e.code === "CALL_IN_PROGRESS");
  mutate(state => { state.agentActive = false });
  await send(call.id, "I'd like an oil change tomorrow morning.");
  assert.equal(getCall(call.id).phase, "details");
});
test("reset cancels a running workflow without late events or writes", async () => {
  process.env.DEMO_STEP_MS = "5";
  const starting = startCall("appointment"); resetState();
  assert.equal(await starting, null);
  assert.equal(snapshot().calls.filter(c => c.source === "session").length, 0);
  assert.equal(snapshot().events.length, 0);
});
test("end call is recorded and repeat termination is safe", async () => {
  const call = (await startCall("appointment"))!;
  await endCall(call.id); await endCall(call.id);
  assert.equal(getCall(call.id).evaluation?.outcome, "cancelled");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
});
test("a fresh process reloads committed bookings and closes interrupted calls safely", async () => {
  const bookedId = await readyToConfirm(); await send(bookedId, "Yes, please book it.");
  const interrupted = (await startCall("conflict"))!;
  const url = pathToFileURL(path.resolve("src/server/store.ts")).href;
  const script = `const mod = await import(${JSON.stringify(url)}); const snapshot = mod.snapshot || mod.default.snapshot; process.stdout.write(JSON.stringify(snapshot()));`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, DEMO_DATA_DIR: directory }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const restored = JSON.parse(result.stdout);
  assert.equal(restored.appointments.filter((a: { callId: string }) => a.callId === bookedId).length, 1);
  assert.equal(restored.calls.find((c: { id: string }) => c.id === bookedId).status, "completed");
  const closed = restored.calls.find((c: { id: string }) => c.id === interrupted.id);
  assert.equal(closed.status, "ended"); assert.equal(closed.processing, false);
  assert.equal(closed.evaluation.outcome, "cancelled");
});
test("validation rejects malformed input and unknown local tool arguments", async () => {
  const call = (await startCall("appointment"))!;
  await assert.rejects(submitInput(call.id, { text: "", messageId: "valid-message-id" }), (e: unknown) => e instanceof DemoError && e.code === "INVALID_INPUT");
  assert.throws(() => mutate(state => dispatchTool(state, call.id, "check_availability", { service: "Oil change", date: "2026-99-99" })), (e: unknown) => e instanceof DemoError && e.code === "INVALID_TOOL_ARGUMENTS");
  assert.throws(() => mutate(state => dispatchTool(state, call.id, "check_availability", { service: "Oil change", date: dateOffset(1), extra: "not allowed" })), (e: unknown) => e instanceof DemoError && e.code === "INVALID_TOOL_ARGUMENTS");
  assert.equal(snapshot().appointments.filter(a => a.source === "session").length, 0);
});
test("local route writes reject cross-origin requests and invalid JSON", async () => {
  await assert.rejects(body(new Request("http://localhost:3000/api/calls", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: "{}" })), (e: unknown) => e instanceof DemoError && e.code === "ORIGIN_REJECTED");
  await assert.rejects(body(new Request("http://localhost:3000/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), (e: unknown) => e instanceof DemoError && e.code === "INVALID_JSON");
});
