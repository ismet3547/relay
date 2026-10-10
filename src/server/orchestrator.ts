import { z } from "zod";
import { dateOffset, formatDate, formatTime } from "../lib/date";
import { CallSession, Entities, Scenario, isTerminal } from "../lib/types";
import { DemoError, FlowCancelled } from "./errors";
import { event, id, liveCall, now, stage, waitStep } from "./events";
import { finishCall } from "./evaluation";
import { emptyPipeline } from "./seed";
import { mutate, snapshot } from "./store";
import { runTool } from "./tools";

export const scenarioSchema = z.object({ scenario: z.enum(["appointment", "conflict", "handoff"]) }).strict();
export const inputSchema = z.object({ text: z.string().trim().min(1).max(500), messageId: z.string().min(8).max(100) }).strict();
export function getCall(callId: string): CallSession {
  const call = snapshot().calls.find(c => c.id === callId);
  if (!call) throw new DemoError("CALL_NOT_FOUND", "This call no longer exists. Start a new demo call.", 404);
  return call;
}
export async function startCall(scenario: Scenario) {
  const callId = id("CALL");
  mutate(state => {
    if (!state.agentActive) throw new DemoError("AGENT_PAUSED", "Resume the agent before starting a new call.", 409);
    if (state.calls.some(c => c.source === "session" && !isTerminal(c))) throw new DemoError("CALL_IN_PROGRESS", "Finish the current call before starting another.", 409);
    const customerId = scenario === "appointment" ? "cust-olivia" : scenario === "conflict" ? "cust-marcus" : "cust-jamie";
    state.calls.unshift({ id: callId, customerId, scenario, source: "session", status: "connecting", phase: "request", startedAt: now(), processing: true,
      intent: "Not detected yet", entities: {}, missingInfo: [], nextAction: "Await customer request", decisionSummary: "Connecting a simulated inbound call.", activeStage: "conversation",
      pipeline: emptyPipeline(), transcript: [], availableSlots: [], inputIds: [], issues: [] });
    event(state, callId, "conversation", "call_started", "Simulated incoming call started", { scenario, customerId, transport: "local text simulation" });
  });
  try {
    await waitStep();
    await respond(callId, "Hi, you've reached Northline Auto. I'm Nova, your service assistant. How can I help today?");
  } catch (error) { if (!(error instanceof FlowCancelled)) throw error }
  finally { if (snapshot().calls.some(c => c.id === callId)) mutate(state => { state.calls.find(c => c.id === callId)!.processing = false }) }
  return snapshot().calls.find(c => c.id === callId) ?? null;
}
export function extractEntities(text: string): Partial<Entities> {
  const result: Partial<Entities> = {};
  if (/oil\s*(change|service)/i.test(text)) result.service = "Oil change";
  if (/tomorrow/i.test(text)) result.date = dateOffset(1);
  else if (/\btoday\b/i.test(text)) result.date = dateOffset(0);
  else { const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/); if (date) result.date = date[0] }
  if (/\bmorning\b/i.test(text)) result.preference = "morning";
  if (/\bafternoon\b/i.test(text)) result.preference = "afternoon";
  const vehicle = text.match(/\b((?:19|20)\d{2}\s+[a-zA-Z][a-zA-Z0-9 -]{2,60})/);
  if (vehicle) result.vehicle = vehicle[1].split(/\s+(?:and|for|at|tomorrow|today|please)\b/i)[0].trim().slice(0, 80);
  const time = text.match(/\b(\d{1,2})(?::([0-5]\d)\s*(am|pm)?|\s*(am|pm))\b/i);
  if (time) {
    let h = Number(time[1]); const suffix = (time[3] || time[4])?.toLowerCase();
    if (suffix && h >= 1 && h <= 12) h = h % 12 + (suffix === "pm" ? 12 : 0);
    if (h >= 0 && h <= 23) result.requestedTime = `${String(h).padStart(2, "0")}:${time[2] || "00"}`;
  }
  return result;
}
async function respond(callId: string, text: string) {
  await stage(callId, "response", "Generating a template-based response", "response_prepared", { simulated: true, text });
  mutate(state => {
    const call = liveCall(state, callId);
    call.transcript.push({ id: id("MSG"), role: "agent", text, at: now() });
    call.status = "listening"; call.activeStage = null;
    event(state, callId, "response", "response_generated", "Agent response delivered", { text, output: "text; optional browser speech" });
  });
}
async function decision(callId: string, action: string, summary: string) {
  mutate(state => { const call = liveCall(state, callId); call.nextAction = action; call.decisionSummary = summary });
  await stage(callId, "decision", action, "decision_selected", { decisionSummary: summary, action, simulated: true, method: "deterministic workflow rules" });
}
async function availability(callId: string, requestedTime?: string) {
  const call = getCall(callId);
  const result = await runTool(callId, "check_availability", { service: call.entities.service, date: call.entities.date, preference: call.entities.preference, ...(requestedTime ? { requestedTime } : {}) });
  const slots = result.availableSlots as string[];
  const alternatives = slots.length ? slots : result.allAvailableSlots as string[];
  mutate(state => { const live = liveCall(state, callId); live.availableSlots = alternatives; live.missingInfo = [] });
  if (requestedTime && result.requestedSlotAvailable) {
    mutate(state => { const live = liveCall(state, callId); live.entities.selectedTime = requestedTime; live.phase = "confirmation"; live.nextAction = "Await explicit customer confirmation" });
    await respond(callId, `${formatTime(requestedTime)} on ${formatDate(call.entities.date!)} is available. Shall I book the oil change for your ${call.entities.vehicle}?`);
  } else {
    mutate(state => {
      const live = liveCall(state, callId); live.phase = "slot"; live.entities.selectedTime = undefined; live.nextAction = "Await time selection";
      if (requestedTime) {
        const issue = `Requested slot ${requestedTime} is unavailable.`;
        if (!live.issues.includes(issue)) live.issues.push(issue);
        event(state, callId, "backend_action", "slot_conflict", "Requested time is unavailable · alternatives returned", { requestedTime, date: live.entities.date, alternatives }, "warning");
      }
    });
    const options = alternatives.slice(0, 3).map(formatTime).join(", ");
    await respond(callId, alternatives.length ? `${requestedTime ? `I'm sorry, ${formatTime(requestedTime)} is unavailable. ` : ""}I have ${options} on ${formatDate(call.entities.date!)}. Which time works for you?` : "There are no available times on that date. Please choose a different date, or ask for a service advisor.");
  }
}
async function handoff(callId: string, reason: string) {
  await decision(callId, "Request human assistance", "This request is outside the agent's approved booking scope.");
  const call = getCall(callId);
  const result = await runTool(callId, "request_human_handoff", { customerId: call.customerId, reason });
  mutate(state => { liveCall(state, callId).handoffId = result.id as string });
  await respond(callId, "A service advisor needs to review this request. I've added your conversation to the local handoff queue so they have the context. This demo does not contact a real advisor.");
  await finishCall(callId, "handoff");
}
async function processTurn(callId: string, text: string) {
  await stage(callId, "input", "Customer input received", "customer_input", { text, source: "typed demo input" });
  await stage(callId, "speech_to_text", "Text passed through · speech recognition simulated", "transcript_ready", { text, simulated: true });
  const entities = extractEntities(text);
  const unsupported = /warranty|refund|accident|diagnos|brake|engine|insurance|human|advisor|manager|speak to|talk to|\b(tire|tyre|transmission|bodywork|tow|battery|coolant|alignment|inspection|repair)\b|cancel (?:my|an? existing)|reschedule/i.test(text);
  const declined = /\b(no|decline|cancel|stop|nevermind)\b|don't|do not/i.test(text);
  let call = getCall(callId);
  const previousEntities = { ...call.entities };
  const intent = unsupported ? "Human assistance" : call.intent === "Not detected yet" ? /oil|book|appointment/i.test(text) ? "Book appointment" : "Unsupported request" : call.intent;
  mutate(state => { const live = liveCall(state, callId); live.intent = intent; live.entities = { ...live.entities, ...entities } });
  await stage(callId, "intent", `Intent identified · ${intent}`, "intent_identified", { intent, extractedEntities: entities, simulated: true, method: "keyword and entity rules" });
  call = getCall(callId);
  if (unsupported || intent === "Unsupported request") {
    await stage(callId, "conversation", "Request requires a human", "scope_checked", { approvedScope: "oil-change appointment booking" });
    return handoff(callId, text);
  }
  if (declined) {
    await decision(callId, "Close without booking", "Customer declined or cancelled. No booking tool is permitted.");
    await respond(callId, "No problem. I haven't created an appointment. You can start another demo call whenever you're ready.");
    return finishCall(callId, "declined");
  }
  const missing = [!call.entities.service && "service", !call.entities.date && "appointment date", !call.entities.vehicle && "vehicle year, make and model"].filter(Boolean) as string[];
  mutate(state => { liveCall(state, callId).missingInfo = missing });
  await stage(callId, "conversation", missing.length ? "Missing information identified" : `Conversation state · ${call.phase}`, "conversation_state", { phase: call.phase, entities: call.entities, missingInfo: missing });
  if (missing.length) {
    mutate(state => { liveCall(state, callId).phase = "details" });
    await decision(callId, "Collect missing information", "Required appointment fields are incomplete. No write action is allowed.");
    mutate(state => { event(state, callId, "conversation", "information_requested", "Requesting missing appointment details", { fields: missing }) });
    await respond(callId, `I can help with an oil change. Could you share ${missing.join(" and ")}?`);
    return;
  }
  if (call.phase === "confirmation") {
    if ((entities.requestedTime && entities.requestedTime !== call.entities.selectedTime) || (entities.date && entities.date !== previousEntities.date)) {
      await decision(callId, "Check revised appointment", "A changed selection requires a fresh availability check and confirmation.");
      return availability(callId, entities.requestedTime);
    }
    if (!/\byes\b|confirm|go ahead|sounds good|please book|book it/i.test(text)) {
      await decision(callId, "Request confirmation", "Booking remains pending until the customer explicitly confirms.");
      await respond(callId, `Please confirm: should I book ${formatTime(call.entities.selectedTime!)} on ${formatDate(call.entities.date!)}? You can say yes or decline.`);
      return;
    }
    await decision(callId, "Create and verify appointment", "Customer confirmed the selected slot. Save once, then verify the persisted record.");
    try {
      const booking = await runTool(callId, "create_booking", { service: call.entities.service, date: call.entities.date, time: call.entities.selectedTime, customerId: call.customerId, vehicle: call.entities.vehicle, idempotencyKey: callId });
      mutate(state => { liveCall(state, callId).bookingId = booking.id as string });
      const lookup = await runTool(callId, "lookup_booking", { bookingId: booking.id });
      if (lookup.verified !== true || lookup.callId !== callId || lookup.date !== call.entities.date || lookup.time !== call.entities.selectedTime) throw new DemoError("VERIFICATION_FAILED", "Booking result did not match the selected appointment.", 500);
      await stage(callId, "verification", "Booking verified against the local data store", "booking_verified", { bookingId: booking.id, date: lookup.date, time: lookup.time, verified: true });
      await respond(callId, `You're booked! Your oil change is confirmed for ${formatTime(call.entities.selectedTime!)} on ${formatDate(call.entities.date!)}. Your reference is ${booking.id}. We'll see you then.`);
      await finishCall(callId, "booked");
    } catch (error) {
      if (error instanceof DemoError && error.code === "SLOT_CONFLICT") {
        mutate(state => { liveCall(state, callId).issues.push("Slot became unavailable before confirmation.") });
        await availability(callId, call.entities.selectedTime);
      } else throw error;
    }
    return;
  }
  await decision(callId, "Check appointment availability", "Required fields are present. Read available slots before offering a booking.");
  await availability(callId, entities.requestedTime ?? call.entities.requestedTime);
}

export async function submitInput(callId: string, raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new DemoError("INVALID_INPUT", parsed.error.issues.map(i => i.message).join(" "));
  const { text, messageId } = parsed.data;
  const call = getCall(callId);
  if (call.inputIds.includes(messageId)) return call;
  if (isTerminal(call)) throw new DemoError("CALL_ENDED", "This conversation has ended. Start a new demo call.", 409);
  if (call.processing) throw new DemoError("TURN_IN_PROGRESS", "Please wait for the agent's current response.", 409);
  mutate(state => {
    const live = liveCall(state, callId); live.processing = true; live.inputIds.push(messageId);
    live.transcript.push({ id: id("MSG"), role: "customer", text, at: now() });
  });
  try { await processTurn(callId, text) }
  catch (error) {
    if (error instanceof FlowCancelled) return null;
    mutate(state => { const live = liveCall(state, callId); live.issues.push(error instanceof DemoError ? error.message : "A local tool encountered an unexpected error."); event(state, callId, "backend_action", "workflow_error", "Workflow stopped safely", { code: error instanceof DemoError ? error.code : "INTERNAL_ERROR" }, "error") });
    await handoff(callId, "The workflow could not complete safely. Review the observable tool errors.");
  } finally { if (snapshot().calls.some(c => c.id === callId)) mutate(state => { const current = state.calls.find(c => c.id === callId)!; current.processing = false }) }
  return snapshot().calls.find(c => c.id === callId) ?? null;
}
export async function endCall(callId: string) {
  const call = getCall(callId);
  if (isTerminal(call)) return call;
  if (call.processing) throw new DemoError("TURN_IN_PROGRESS", "Wait for this operation to finish before ending the call.", 409);
  mutate(state => { liveCall(state, callId).processing = true });
  try { await respond(callId, "The operator ended this demo call. No appointment was created."); await finishCall(callId, "cancelled") }
  catch (error) { if (!(error instanceof FlowCancelled)) throw error }
  return snapshot().calls.find(c => c.id === callId) ?? null;
}
