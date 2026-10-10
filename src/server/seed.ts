import { dateOffset } from "../lib/date";
import { CallSession, DemoState, STAGES, Stage, PipelineStep } from "../lib/types";

export function emptyPipeline() {
  return Object.fromEntries(STAGES.map(stage => [stage, { status: "idle", count: 0, detail: "Waiting for an event" }])) as Record<Stage, PipelineStep>;
}
export function seedState(revision = 0): DemoState {
  const now = Date.now();
  const customers = [
    { id: "cust-olivia", name: "Olivia Chen", initials: "OC", phone: "+1 (202) 555-0104", vehicle: "2021 Honda Civic" },
    { id: "cust-marcus", name: "Marcus Reed", initials: "MR", phone: "+1 (202) 555-0118", vehicle: "2020 Volvo XC60" },
    { id: "cust-jamie", name: "Jamie Patel", initials: "JP", phone: "+1 (202) 555-0136", vehicle: "2022 Toyota Corolla" },
    { id: "cust-carter", name: "Carter Blake", initials: "CB", phone: "+1 (202) 555-0142", vehicle: "2019 Toyota RAV4" },
  ];
  const calls: CallSession[] = [164, 112, 183, 95].map((seconds, i) => ({
    id: `seed-call-${i + 1}`, customerId: customers[i].id, scenario: i === 2 ? "handoff" : "appointment", source: "seed",
    status: i === 2 ? "escalated" : "completed", phase: "done", startedAt: new Date(now - (i + 1) * 3_600_000).toISOString(),
    endedAt: new Date(now - (i + 1) * 3_600_000 + seconds * 1000).toISOString(), durationSeconds: seconds, processing: false,
    intent: i === 2 ? "Warranty request" : "Book appointment", entities: { service: "Oil change", vehicle: customers[i].vehicle, date: dateOffset(i === 0 ? 1 : 0), selectedTime: i === 0 ? "14:00" : "11:00" },
    missingInfo: [], nextAction: "None — seeded example", decisionSummary: "Historical demo example, not a live engine execution.", activeStage: null,
    pipeline: emptyPipeline(), transcript: [
      { id: `seed-msg-${i}-1`, role: "customer", text: i === 2 ? "Can someone review my warranty claim?" : "I'd like to book an oil change.", at: new Date(now - (i + 1) * 3_600_000).toISOString() },
      { id: `seed-msg-${i}-2`, role: "agent", text: i === 2 ? "I've requested a service advisor to help you." : "Your service appointment is confirmed. Thank you!", at: new Date(now - (i + 1) * 3_600_000 + seconds * 1000).toISOString() },
    ], availableSlots: [], inputIds: [], issues: [],
    evaluation: { intent: i === 2 ? "Warranty request" : "Book appointment", outcome: i === 2 ? "handoff" : "booked", taskCompleted: i !== 2, toolsSucceeded: 0, toolsFailed: 0, humanRequired: i === 2, issues: [], suggestion: "Seeded illustration. Run a demo call to see an evaluation from actual tool results." },
  }));
  return { version: 1, revision, agentActive: true,
    business: { name: "Northline Auto", timeZone: "UTC", agentName: "Nova", serviceDuration: 45 }, customers, calls,
    appointments: [
      { id: "BK-SEED-0900", customerId: "cust-carter", customerName: "Carter Blake", vehicle: "2019 Toyota RAV4", service: "Oil change", date: dateOffset(1), time: "09:00", source: "seed", createdAt: new Date(now - 86_400_000).toISOString() },
      { id: "BK-SEED-1400", customerId: "cust-olivia", customerName: "Olivia Chen", vehicle: "2021 Honda Civic", service: "Oil change", date: dateOffset(1), time: "14:00", callId: "seed-call-1", source: "seed", createdAt: new Date(now - 3_600_000).toISOString() },
    ], tools: [], events: [], handoffs: [],
  };
}
