import { z } from "zod";
import { dateOffset } from "../lib/date";
import { DemoState, Json, ToolName } from "../lib/types";
import { DemoError } from "./errors";
import { event, id, liveCall, now, stage, waitStep } from "./events";
import { mutate } from "./store";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v && v >= dateOffset(0) && v <= dateOffset(30), "Choose a valid date within the next 30 days.");
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const service = z.literal("Oil change");
export const TOOL_SCHEMAS = {
  check_availability: z.object({ service, date: dateSchema, preference: z.enum(["morning", "afternoon"]).optional(), requestedTime: timeSchema.optional() }).strict(),
  create_booking: z.object({ service, date: dateSchema, time: timeSchema, customerId: z.string().min(1), vehicle: z.string().trim().min(3).max(80), idempotencyKey: z.string().min(1) }).strict(),
  lookup_booking: z.object({ bookingId: z.string().min(1) }).strict(),
  request_human_handoff: z.object({ reason: z.string().trim().min(3).max(500), customerId: z.string().min(1) }).strict(),
};
const SLOTS = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

// A small deterministic tool registry. No simulated database responses.
export function dispatchTool(state: DemoState, callId: string, name: ToolName, raw: Json): Json {
  const parsed = TOOL_SCHEMAS[name].safeParse(raw);
  if (!parsed.success) throw new DemoError("INVALID_TOOL_ARGUMENTS", parsed.error.issues.map(e => e.message).join(" "));
  const call = state.calls.find(c => c.id === callId && c.source === "session");
  if (!call) throw new DemoError("CALL_NOT_FOUND", "This demo call no longer exists.", 404);
  if (name === "check_availability") {
    const args = TOOL_SCHEMAS.check_availability.parse(raw);
    const occupied = state.appointments.filter(a => a.date === args.date).map(a => a.time);
    const currentTime = new Date().toISOString().slice(11, 16);
    const allSlots = SLOTS.filter(time => !occupied.includes(time) && (args.date !== dateOffset(0) || time > currentTime));
    const slots = allSlots.filter(time => args.preference === "morning" ? time < "12:00" : args.preference === "afternoon" ? time >= "12:00" : true);
    return { service: args.service, date: args.date, availableSlots: slots, allAvailableSlots: allSlots, requestedTime: args.requestedTime ?? null, requestedSlotAvailable: args.requestedTime ? allSlots.includes(args.requestedTime) : null, capacity: "one service bay" };
  }
  if (name === "create_booking") {
    const args = TOOL_SCHEMAS.create_booking.parse(raw);
    if (args.idempotencyKey !== callId || args.customerId !== call.customerId) throw new DemoError("INVALID_BOOKING_CONTEXT", "Booking must match the current call and customer.");
    const existing = state.appointments.find(a => a.callId === callId);
    if (existing) {
      if (existing.date !== args.date || existing.time !== args.time || existing.vehicle !== args.vehicle || existing.service !== args.service) throw new DemoError("IDEMPOTENCY_MISMATCH", "This call already created a different appointment.", 409);
      return { ...existing, success: true, replayed: true };
    }
    if (call.phase !== "confirmation" || call.entities.selectedTime !== args.time || call.entities.date !== args.date) throw new DemoError("CONFIRMATION_REQUIRED", "The selected appointment must be confirmed in this call.", 409);
    const currentTime = new Date().toISOString().slice(11, 16);
    if (!SLOTS.includes(args.time) || (args.date === dateOffset(0) && args.time <= currentTime) || state.appointments.some(a => a.date === args.date && a.time === args.time)) throw new DemoError("SLOT_CONFLICT", "That appointment time is no longer available.", 409);
    const customer = state.customers.find(c => c.id === args.customerId);
    if (!customer) throw new DemoError("CUSTOMER_NOT_FOUND", "Fictional customer record not found.", 404);
    const booking = { id: id("BK"), callId, customerId: customer.id, customerName: customer.name, service: args.service, vehicle: args.vehicle, date: args.date, time: args.time, source: "session" as const, createdAt: now() };
    state.appointments.push(booking);
    return { ...booking, success: true, replayed: false };
  }
  if (name === "lookup_booking") {
    const args = TOOL_SCHEMAS.lookup_booking.parse(raw);
    const booking = state.appointments.find(a => a.id === args.bookingId && a.callId === callId);
    if (!booking) throw new DemoError("BOOKING_NOT_FOUND", "The appointment could not be verified for this call.", 404);
    return { ...booking, verified: true };
  }
  const args = TOOL_SCHEMAS.request_human_handoff.parse(raw);
  if (args.customerId !== call.customerId) throw new DemoError("INVALID_HANDOFF_CONTEXT", "Handoff must match the current customer.");
  const previous = state.handoffs.find(h => h.callId === callId);
  if (previous) return { ...previous, replayed: true };
  const handoff = { id: id("HO"), callId, customerId: args.customerId, reason: args.reason, status: "awaiting_human" as const, createdAt: now() };
  state.handoffs.push(handoff);
  return { ...handoff, success: true };
}

export async function runTool(callId: string, name: ToolName, args: Json): Promise<Json> {
  await stage(callId, "tool_selection", `Selected ${name}`, "tool_selected", { tool: name, arguments: args });
  const executionId = id("TOOL");
  mutate(state => {
    const call = liveCall(state, callId);
    call.status = name === "check_availability" || name === "lookup_booking" ? "checking" : "executing";
    call.activeStage = "backend_action";
    call.pipeline.backend_action = { status: "running", count: call.pipeline.backend_action.count + 1, detail: `Executing ${name}`, updatedAt: now() };
    state.tools.push({ id: executionId, callId, name, arguments: args, status: "running", startedAt: now() });
    event(state, callId, "backend_action", "tool_invoked", `Executing ${name}`, { executionId, tool: name, arguments: args });
  });
  await waitStep();
  try {
    return mutate(state => {
      const call = liveCall(state, callId);
      const result = dispatchTool(state, callId, name, args);
      const tool = state.tools.find(t => t.id === executionId)!;
      tool.result = result; tool.status = "success"; tool.completedAt = now(); tool.durationMs = Date.now() - Date.parse(tool.startedAt);
      call.pipeline.backend_action.status = "complete";
      event(state, callId, "backend_action", "tool_completed", `${name} completed`, { executionId, tool: name, result }, "success");
      return result;
    });
  } catch (error) {
    mutate(state => {
      const tool = state.tools.find(t => t.id === executionId);
      if (!tool) return;
      const message = error instanceof Error ? error.message : "Local tool failed.";
      tool.result = { error: message, code: error instanceof DemoError ? error.code : "TOOL_FAILED" }; tool.status = "failure"; tool.completedAt = now(); tool.durationMs = Date.now() - Date.parse(tool.startedAt);
      const call = state.calls.find(c => c.id === callId);
      if (call) call.pipeline.backend_action.status = "error";
      event(state, callId, "backend_action", "tool_failed", `${name} failed`, { executionId, tool: name, ...tool.result }, "error");
    });
    throw error;
  }
}
