"use client";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CornerUpRight,
  MessageSquare,
  Phone,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/date";
import { CallSession, DemoState, isTerminal } from "@/lib/types";
import { EvaluationCard, SourceBadge } from "./ui";

const guidance = {
  request: [
    "Tell Nova what you need",
    "Use a suggested reply or type your own service request.",
  ],
  details: [
    "Share the missing details",
    "Give the date and your vehicle’s year, make, and model when asked.",
  ],
  slot: [
    "Pick an available time",
    "Choose one of the returned times, or decline the alternatives.",
  ],
  confirmation: [
    "Confirm before it’s saved",
    "Check the appointment details, then confirm or cancel.",
  ],
  done: [
    "Your conversation is complete",
    "The result is saved locally and available in Results & activity.",
  ],
};
export function CallResult({
  state,
  call,
  onEngine,
}: {
  state: DemoState;
  call?: CallSession;
  onEngine: () => void;
}) {
  const booking = state.appointments.find((a) => a.id === call?.bookingId);
  const handoff = state.handoffs.find((h) => h.id === call?.handoffId);
  const ended = call && isTerminal(call);
  const [title, description] = guidance[call?.phase || "request"];
  return (
    <aside className="call-result-aside">
      <section className="panel call-result-card">
        <span className="eyebrow">
          {ended
            ? "CONVERSATION RESULT"
            : call
              ? "YOUR NEXT STEP"
              : "A QUICK WALKTHROUGH"}
        </span>
        {booking ? (
          <>
            <span className="call-result-symbol">
              <Check size={26} />
            </span>
            <h2>Appointment saved.</h2>
            <p>
              {booking.customerName} · {booking.service}
            </p>
            <div className="result-appointment">
              <span>{formatDate(booking.date)}</span>
              <strong>{formatTime(booking.time)}</strong>
              <span>{booking.vehicle} · 45 minutes</span>
            </div>
            <div className="result-reference">
              <span>Booking reference</span>
              <code>{booking.id}</code>
            </div>
            <SourceBadge source={booking.source} />
          </>
        ) : handoff || call?.status === "escalated" ? (
          <>
            <span className="call-result-symbol handoff-symbol">
              <CornerUpRight size={26} />
            </span>
            <h2>Ready for an advisor.</h2>
            <p>
              {handoff
                ? "The request and conversation context are saved in the local handoff queue."
                : "This example ended with a human handoff."}
            </p>
            {handoff && (
              <div className="result-reference">
                <span>Handoff reference</span>
                <code>{handoff.id}</code>
              </div>
            )}
            <small>An actual advisor has not been contacted.</small>
          </>
        ) : call ? (
          <>
            <span className="call-result-symbol next-symbol">
              {ended ? <CalendarDays size={26} /> : <MessageSquare size={26} />}
            </span>
            <h2>{ended ? "No appointment created." : title}</h2>
            <p>
              {ended
                ? call.evaluation?.outcome === "declined"
                  ? "The suggested alternatives were declined. Nothing was booked."
                  : "The conversation ended without a confirmed booking."
                : description}
            </p>
            {!ended && call.missingInfo.length > 0 && (
              <div className="needed-details">
                <span>Nova still needs</span>
                <p>
                  {call.missingInfo
                    .map((s) =>
                      s.replace(
                        "vehicle year, make and model",
                        "Vehicle details",
                      ),
                    )
                    .join(" · ")}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="call-result-symbol next-symbol">
              <Phone size={26} />
            </span>
            <h2>Try a service conversation.</h2>
            <p>
              You play the customer. Nova follows the request through to a local
              result.
            </p>
            <ol className="call-walkthrough">
              <li>
                <span>1</span>Choose a scenario and start a call.
              </li>
              <li>
                <span>2</span>Reply using buttons or your own words.
              </li>
              <li>
                <span>3</span>Confirm an appointment or try a handoff.
              </li>
            </ol>
            <small>
              The call and voice are simulated; local booking actions are real.
            </small>
          </>
        )}
        <button className="text-button" onClick={onEngine}>
          See how this works
          <ArrowRight size={14} />
        </button>
      </section>
      {call?.evaluation && (
        <details className="call-evaluation-details">
          <summary>
            Review conversation
            <ChevronDown size={16} />
          </summary>
          <EvaluationCard evaluation={call.evaluation} source={call.source} />
        </details>
      )}
    </aside>
  );
}
