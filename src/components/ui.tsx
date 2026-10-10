"use client";
import { Check, CircleDot, Clock3, CornerUpRight, Phone, X } from "lucide-react";
import { CallSession, Customer, Evaluation, Source } from "@/lib/types";

export function SourceBadge({ source }: { source: Source }) { return <span className={`source-badge ${source}`}>{source === "seed" ? "Seeded example" : "This session"}</span> }
const STATUS_LABELS: Record<CallSession["status"], string> = { connecting: "Connecting", listening: "Listening", understanding: "Understanding request", checking: "Checking information", executing: "Executing operation", responding: "Responding", completed: "Completed", escalated: "Escalated", ended: "Ended" };
export function StatusBadge({ status }: { status: CallSession["status"] }) {
  const Icon = status === "completed" ? Check : status === "escalated" ? CornerUpRight : status === "ended" ? X : CircleDot;
  return <span className={`status-badge status-${status}`}><Icon size={13} />{STATUS_LABELS[status]}</span>;
}
export function Avatar({ customer, small = false }: { customer: Customer; small?: boolean }) { return <span className={`avatar ${small ? "small" : ""} avatar-${customer.id.split("-")[1]}`}>{customer.initials}</span> }
export function JsonView({ data }: { data: unknown }) { return <pre className="json-view">{JSON.stringify(data, null, 2)}</pre> }
export function EvaluationCard({ evaluation, source }: { evaluation: Evaluation; source: Source }) {
  return <section className="panel evaluation-panel">
    <div className="panel-heading"><span className="eyebrow">CONVERSATION EVALUATION</span><SourceBadge source={source} /></div>
    <div className={`evaluation-title ${evaluation.taskCompleted ? "positive" : ""}`}>{evaluation.taskCompleted ? <Check size={20} /> : evaluation.humanRequired ? <CornerUpRight size={20} /> : <Clock3 size={20} />}<h3>{evaluation.taskCompleted ? "Task completed" : evaluation.humanRequired ? "Ready for a human" : "Closed without a booking"}</h3></div>
    <dl className="detail-list"><div><dt>Customer intent</dt><dd>{evaluation.intent}</dd></div><div><dt>Tool executions</dt><dd>{evaluation.toolsSucceeded} succeeded · {evaluation.toolsFailed} failed</dd></div><div><dt>Human intervention</dt><dd>{evaluation.humanRequired ? "Required · queued locally" : "Not required"}</dd></div></dl>
    {evaluation.issues.length > 0 && <div className="evaluation-issues"><span className="eyebrow">OBSERVED ISSUES</span>{evaluation.issues.map((issue, i) => <p key={i}>{issue}</p>)}</div>}
    <div className="suggestion"><span className="eyebrow">NEXT ITERATION</span><p>{evaluation.suggestion}</p></div>
  </section>;
}
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Phone size={20} /></span><h3>{title}</h3><p>{children}</p></div> }
