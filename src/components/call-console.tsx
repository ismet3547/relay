"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Headphones, Loader2, MessageSquare, Phone, PhoneOff, Radio, Send, Sparkles } from "lucide-react";
import { dateOffset, duration, formatTime } from "@/lib/date";
import { CallSession, DemoState, Scenario, isTerminal } from "@/lib/types";
import { Avatar, SourceBadge, StatusBadge } from "./ui";

export const SCENARIOS: Record<Scenario, { title: string; short: string; hint: string; input: string }> = {
  appointment: { title: "Successful appointment", short: "Book an oil change", hint: "Collect details. Find a slot. Make a verified booking.", input: "I'd like to book an oil change for tomorrow morning." },
  conflict: { title: "Scheduling conflict", short: "Request an occupied slot", hint: "Tomorrow at 9 AM is seeded as occupied. Choose an alternative or decline.", input: "Can I book an oil change tomorrow at 9:00 AM?" },
  handoff: { title: "Human handoff", short: "Request a warranty refund", hint: "Ask something outside the approved booking scope.", input: "Can you approve a warranty refund for my repair?" },
};
function choices(call: CallSession, scenario: Scenario) {
  if (call.phase === "request") return [{ label: SCENARIOS[scenario].short, text: SCENARIOS[scenario].input }, { label: "Ask for an advisor", text: "I'd like to speak to a service advisor." }];
  if (call.phase === "details") return call.missingInfo.some(field => field !== "vehicle year, make and model")
    ? [{ label: "Oil change · tomorrow · Honda Civic", text: "An oil change tomorrow morning. My car is a 2021 Honda Civic." }]
    : [{ label: "2021 Honda Civic", text: "My car is a 2021 Honda Civic." }, { label: "2020 Volvo XC60", text: "My car is a 2020 Volvo XC60." }];
  if (call.phase === "slot") return [...call.availableSlots.slice(0, 3).map(time => ({ label: formatTime(time), text: `I'd like ${time}, please.` })), { label: call.availableSlots.length ? "Decline" : "Try another date", text: call.availableSlots.length ? "No, please cancel." : `Please check ${dateOffset(2)}.` }];
  if (call.phase === "confirmation") return [{ label: "Yes, confirm booking", text: "Yes, please book it." }, { label: "No, cancel", text: "No, please cancel." }];
  return [];
}
interface Props {
  state: DemoState; call?: CallSession; scenario: Scenario; setScenario: (value: Scenario) => void;
  busy: boolean; connected: boolean; compact?: boolean;
  onStart: () => void; onSend: (text: string) => Promise<boolean>; onEnd: () => void; onEngine?: () => void;
}
export function CallConsole({ state, call, scenario, setScenario, busy, connected, compact = false, onStart, onSend, onEnd, onEngine }: Props) {
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);
  const transcriptPane = useRef<HTMLDivElement>(null);
  const active = state.calls.some(c => c.source === "session" && !isTerminal(c));
  const ended = call && isTerminal(call);
  const disabled = busy || !!call?.processing || !connected;
  const customer = state.customers.find(c => c.id === call?.customerId);
  const seconds = call?.durationSeconds ?? (call ? Math.max(0, Math.floor((tick - Date.parse(call.startedAt)) / 1000)) : 0);
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer) }, []);
  useEffect(() => { const pane = transcriptPane.current; if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" }) }, [call?.id, call?.transcript.length]);
  async function send(value: string) { if (!disabled && value.trim()) { const success = await onSend(value.trim()); if (success) setText("") } }

  return <section className={`panel call-console ${compact ? "compact" : ""}`} aria-label="Live call console">
    <div className="panel-heading"><div className="inline-label"><Radio size={16} /><h2>{compact ? "Conversation console" : "Live call"}</h2></div><span className="subtle-tag">SIMULATED INBOUND</span></div>
    <div className="scenario-control"><label htmlFor={compact ? "engine-scenario" : "ops-scenario"}>Scenario</label><div className="select-wrap"><select id={compact ? "engine-scenario" : "ops-scenario"} value={scenario} onChange={e => setScenario(e.target.value as Scenario)} disabled={active || busy}>{Object.entries(SCENARIOS).map(([key, value]) => <option key={key} value={key}>{value.title}</option>)}</select><ChevronDown size={14} /></div></div>
    {!call || !customer ? <div className="call-ready">
      <div className="agent-orbit"><span className="orbit-line" /><span className="agent-avatar"><Sparkles size={28} strokeWidth={1.5} /></span><span className="orbit-dot" /><div className="ready-bars" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ height: `${10 + ((i * 13) % 30)}px` }} />)}</div></div>
      <span className="eyebrow">NOVA · SERVICE ASSISTANT</span><h3>One conversation.<br />An operation, handled.</h3><p>{SCENARIOS[scenario].hint}</p>
      <button className="button primary start-button" disabled={disabled || !state.agentActive || active} onClick={onStart}>{busy ? <Loader2 className="spin" size={17} /> : <Phone size={17} />}Start Demo Call<ArrowRight size={16} /></button>
      <span className="call-disclaimer">Fictional customer · local text simulation</span>
    </div> : <>
      <div className="call-identity"><Avatar customer={customer} /><div><h3>{customer.name}</h3><span>{customer.phone}</span></div><div className="call-clock"><span className={!ended ? "live-dot" : "idle-dot"} /><span>{duration(seconds)}</span></div></div>
      <div className="call-state-row"><StatusBadge status={call.status} /><SourceBadge source={call.source} /></div>
      <div className={`voice-strip ${!ended ? "voice-active" : ""} ${call.status === "responding" ? "speaking" : ""}`} aria-label="Simulated voice activity"><span className="nova-icon"><Sparkles size={15} /></span><div><strong>Nova</strong><span>{call.processing ? call.pipeline[call.activeStage || "conversation"].detail : ended ? "Conversation finished" : "Ready for your input"}</span></div><div className="voice-bars" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${i * -0.13}s`, height: `${6 + ((i * 7) % 23)}px` }} />)}</div></div>
      <div className="transcript" ref={transcriptPane} role="log" aria-label="Conversation transcript" aria-live="polite">{call.transcript.map(message => <div key={message.id} className={`transcript-message message-${message.role}`}><span className="message-role">{message.role === "agent" ? "NOVA" : customer.name.split(" ")[0].toUpperCase()}<time>{new Date(message.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</time></span><p>{message.text}</p></div>)}{call.processing && <div className="typing-indicator"><i /><i /><i /><span>Processing local workflow</span></div>}</div>
      {!ended ? <div className="customer-controls"><div className="input-caption"><MessageSquare size={13} /><span>You are the customer. Choose a reply or type your own.</span></div><div className="quick-replies">{choices(call, scenario).map(choice => <button key={choice.label} disabled={disabled} onClick={() => send(choice.text)}>{choice.label}<ArrowRight size={12} /></button>)}</div><form onSubmit={e => { e.preventDefault(); void send(text) }}><input aria-label="Customer message" maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Type a customer response…" disabled={disabled} /><button className="send-button" type="submit" aria-label="Send customer message" disabled={disabled || !text.trim()}><Send size={16} /></button></form><div className="call-footer"><span><Headphones size={12} />Text input · voice processing simulated</span><button className="text-button" disabled={disabled} onClick={onEnd}><PhoneOff size={13} />End call</button></div></div>
        : <div className="finished-controls"><span>{call.source === "seed" ? "Historical demo example" : call.bookingId ? `Saved locally · ${call.bookingId}` : call.handoffId ? `Queued locally · ${call.handoffId}` : "No appointment created"}</span><button className="button primary" disabled={disabled || active || !state.agentActive} onClick={onStart}><Phone size={15} />New demo call</button></div>}
    </>}
    {onEngine && <button className="engine-link" onClick={onEngine}>See how the engine works<ArrowRight size={14} /></button>}
  </section>;
}
