import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

// Starts a temporary dev server solely for HTTP integration checks, then tears it down.
const port = Number(process.env.TEST_PORT || 3100);
const base = `http://127.0.0.1:${port}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-api-"));
let log = "";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, DEMO_DATA_DIR: directory, DEMO_STEP_MS: "10", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", data => { log += data.toString() });
server.stderr.on("data", data => { log += data.toString() });
async function api(url, data, method = "POST") {
  const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, data: await response.json() };
}
const state = async () => (await api("/api/demo", undefined, "GET")).data;
let index = 0;
const send = (id, text, messageId = `api-message-${++index}`) => api(`/api/calls/${id}/input`, { text, messageId });
async function start(scenario) { const result = await api("/api/calls", { scenario }); assert.equal(result.status, 200); return result.data.call.id }
const successes = [];
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error("Next dev exited before readiness.");
    try { const response = await fetch(base, { signal: AbortSignal.timeout(1500) }); if (response.ok) { const html = await response.text(); assert.match(html, /Relay|relay/); ready = true; break } } catch { /* Wait for compilation. */ }
    await wait(300);
  }
  assert.ok(ready, "Development server did not become ready."); successes.push("Development server and App Router document return HTTP 200");
  const streamController = new AbortController();
  const streamResponse = await fetch(base + "/api/events", { signal: streamController.signal });
  assert.equal(streamResponse.headers.get("content-type"), "text/event-stream");
  const reader = streamResponse.body.getReader();
  let buffer = ""; let streamed = null;
  async function latestStream(revision) {
    const deadline = Date.now() + 15000;
    while (!streamed || streamed.revision < revision) {
      assert.ok(Date.now() < deadline, "SSE did not catch up to backend state.");
      const chunk = await Promise.race([reader.read(), wait(15000).then(() => { throw new Error("SSE timeout") })]);
      buffer += new TextDecoder().decode(chunk.value);
      let split;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, split); buffer = buffer.slice(split + 2);
        const data = block.split("\n").find(line => line.startsWith("data: "));
        if (data) streamed = JSON.parse(data.slice(6));
      }
    }
    return streamed;
  }
  await latestStream((await state()).revision);
  let id = await start("appointment");
  await send(id, "I'd like an oil change tomorrow morning.");
  assert.deepEqual((await state()).calls.find(c => c.id === id).missingInfo, ["vehicle year, make and model"]);
  await send(id, "My car is a 2021 Honda Civic."); await send(id, "10:00 AM, please.");
  await send(id, "Yes, please book it.", "api-duplicate-confirmation");
  const bookedState = await state(); const booking = bookedState.appointments.find(a => a.callId === id);
  assert.ok(booking); assert.equal(bookedState.calls.find(c => c.id === id).evaluation.taskCompleted, true);
  const live = await latestStream(bookedState.revision);
  assert.deepEqual(live.appointments, bookedState.appointments);
  assert.deepEqual(live.calls, bookedState.calls);
  assert.ok(live.events.some(e => e.type === "booking_verified"));
  successes.push("Successful appointment is persisted and verified; SSE and HTTP state match");
  const before = bookedState.tools.length;
  await send(id, "Yes, please book it.", "api-duplicate-confirmation");
  assert.equal((await state()).appointments.filter(a => a.callId === id).length, 1);
  assert.equal((await state()).tools.length, before); successes.push("Replayed booking confirmation creates no duplicate or extra execution");
  id = await start("conflict");
  await send(id, "An oil change tomorrow at 9:00 AM. My car is a 2020 Volvo XC60.");
  assert.equal((await state()).tools.filter(t => t.callId === id).at(-1).result.requestedSlotAvailable, false);
  await send(id, "11:00 AM, please."); await send(id, "Yes, please book it.");
  assert.equal((await state()).appointments.find(a => a.callId === id).time, "11:00");
  successes.push("Scheduling conflict returns alternatives; an accepted alternative is saved");
  id = await start("conflict");
  await send(id, "An oil change tomorrow at 9:00 AM. My car is a 2020 Volvo XC60."); await send(id, "No, please cancel.");
  assert.equal((await state()).calls.find(c => c.id === id).evaluation.outcome, "declined");
  assert.equal((await state()).appointments.filter(a => a.callId === id).length, 0);
  successes.push("Declined alternatives end without an appointment");
  id = await start("handoff"); await send(id, "Can you approve a warranty refund for my repair?");
  assert.equal((await state()).calls.find(c => c.id === id).status, "escalated");
  assert.ok((await state()).handoffs.find(h => h.callId === id)); successes.push("Human handoff creates a real local queue record");
  assert.equal((await api("/api/calls", { scenario: "invalid" })).status, 400);
  assert.equal((await api("/api/calls/nonexistent/input", { text: "Hello", messageId: "api-invalid-id" })).status, 404);
  await api("/api/demo", { agentActive: false }, "PATCH");
  assert.equal((await api("/api/calls", { scenario: "appointment" })).status, 409);
  successes.push("Validation, missing calls, and paused intake return safe errors");
  await api("/api/demo/reset", {}); const reset = await state();
  assert.equal(reset.calls.filter(c => c.source === "session").length, 0);
  assert.equal(reset.appointments.length, 2); assert.equal(reset.events.length, 0);
  streamController.abort(); await reader.cancel().catch(() => {});
  successes.push("Reset restores replayable seeded data");
  for (const success of successes) process.stdout.write(`PASS ${success}\n`);
} catch (error) { process.stderr.write(log.slice(-6000) + "\n"); throw error }
finally {
  server.kill("SIGTERM");
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once("exit", resolve); setTimeout(() => { server.kill("SIGKILL"); resolve() }, 3000).unref() } });
  fs.rmSync(directory, { recursive: true, force: true });
}
