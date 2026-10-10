import { Evaluation } from "../lib/types";
import { event, liveCall, now, stage } from "./events";
import { mutate } from "./store";

export async function finishCall(callId: string, outcome: Evaluation["outcome"]) {
  await stage(callId, "evaluation", "Evaluating observable call outcome", "evaluation_started", { outcome });
  mutate(state => {
    const call = liveCall(state, callId);
    const tools = state.tools.filter(t => t.callId === callId);
    const booking = state.appointments.find(a => a.callId === callId);
    const verified = tools.some(t => t.name === "lookup_booking" && t.status === "success" && t.result?.verified === true);
    const handoff = state.handoffs.find(h => h.callId === callId);
    call.evaluation = {
      intent: call.intent, outcome, taskCompleted: outcome === "booked" && !!booking && verified,
      toolsSucceeded: tools.filter(t => t.status === "success").length,
      toolsFailed: tools.filter(t => t.status === "failure").length,
      humanRequired: !!handoff, issues: [...call.issues],
      suggestion: outcome === "handoff" ? "Keep this request with a service advisor. Add a reviewed warranty policy before expanding agent scope." : call.issues.length ? "Offer available alternatives early and confirm the selected time before writing the booking." : outcome === "declined" || outcome === "cancelled" ? "Offer another time or a human callback before closing the next conversation." : "Keep explicit confirmation and a booking lookup as required steps for future integrations.",
    };
    call.status = outcome === "booked" ? "completed" : outcome === "handoff" ? "escalated" : "ended";
    call.phase = "done"; call.endedAt = now(); call.durationSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(call.startedAt)) / 1000));
    call.processing = false; call.activeStage = null; call.nextAction = "Review final evaluation";
    event(state, callId, "evaluation", "conversation_completed", outcome === "handoff" ? "Human handoff requested" : outcome === "booked" ? "Conversation completed · appointment verified" : "Conversation ended · no appointment created", { evaluation: call.evaluation, bookingId: booking?.id ?? null, handoffId: handoff?.id ?? null }, outcome === "booked" ? "success" : "warning");
  });
}
