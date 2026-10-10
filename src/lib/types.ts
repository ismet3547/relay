export const STAGES = ["input", "speech_to_text", "intent", "conversation", "decision", "tool_selection", "backend_action", "verification", "response", "evaluation"] as const;
export type Stage = (typeof STAGES)[number];
export type Scenario = "appointment" | "conflict" | "handoff";
export type Source = "seed" | "session";
export type CallStatus = "connecting" | "listening" | "understanding" | "checking" | "executing" | "responding" | "completed" | "escalated" | "ended";
export type ToolName = "check_availability" | "create_booking" | "lookup_booking" | "request_human_handoff";
export type Json = Record<string, unknown>;

export interface Customer { id: string; name: string; initials: string; phone: string; vehicle: string }
export interface Transcript { id: string; role: "customer" | "agent"; text: string; at: string }
export interface PipelineStep { status: "idle" | "running" | "complete" | "error"; count: number; detail: string; updatedAt?: string }
export interface Entities { service?: "Oil change"; date?: string; preference?: "morning" | "afternoon"; vehicle?: string; requestedTime?: string; selectedTime?: string }
export interface Evaluation {
  intent: string; outcome: "booked" | "declined" | "handoff" | "cancelled";
  taskCompleted: boolean; toolsSucceeded: number; toolsFailed: number;
  humanRequired: boolean; issues: string[]; suggestion: string;
}
export interface CallSession {
  id: string; customerId: string; scenario: Scenario; source: Source;
  status: CallStatus; phase: "request" | "details" | "slot" | "confirmation" | "done";
  startedAt: string; endedAt?: string; durationSeconds?: number; processing: boolean;
  intent: string; entities: Entities; missingInfo: string[];
  nextAction: string; decisionSummary: string; activeStage: Stage | null;
  pipeline: Record<Stage, PipelineStep>; transcript: Transcript[];
  availableSlots: string[]; inputIds: string[]; issues: string[];
  bookingId?: string; handoffId?: string; evaluation?: Evaluation;
}
export interface Appointment {
  id: string; customerId: string; customerName: string; vehicle: string;
  service: "Oil change"; date: string; time: string; callId?: string;
  source: Source; createdAt: string;
}
export interface DemoEvent {
  id: string; callId: string; type: string; label: string; stage: Stage;
  severity: "info" | "success" | "warning" | "error"; at: string; metadata: Json;
}
export interface ToolExecution {
  id: string; callId: string; name: ToolName; arguments: Json;
  result?: Json; status: "running" | "success" | "failure";
  startedAt: string; completedAt?: string; durationMs?: number;
}
export interface Handoff { id: string; callId: string; customerId: string; reason: string; status: "awaiting_human"; createdAt: string }
export interface DemoState {
  version: 1; revision: number; agentActive: boolean;
  business: { name: string; timeZone: string; agentName: string; serviceDuration: number };
  customers: Customer[]; appointments: Appointment[]; calls: CallSession[];
  tools: ToolExecution[]; events: DemoEvent[]; handoffs: Handoff[];
}
export const isTerminal = (call: CallSession) => ["completed", "escalated", "ended"].includes(call.status);
