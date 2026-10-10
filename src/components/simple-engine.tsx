"use client";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Phone,
  Video,
  X,
} from "lucide-react";
import { CallSession, DemoState, Stage, isTerminal } from "@/lib/types";
import { VideoJob, VIDEO_STAGES, VideoStage } from "@/lib/video";
import { AgentInspector, EventTimeline, Pipeline, ToolMonitor } from "./engine";
import { JsonView } from "./ui";

const callSteps: { label: string; stages: Stage[]; description: string }[] = [
  {
    label: "Listen",
    stages: ["input", "speech_to_text"],
    description: "Receive the customer’s typed request.",
  },
  {
    label: "Understand",
    stages: ["intent", "conversation"],
    description: "Identify the request and collect missing details.",
  },
  {
    label: "Decide",
    stages: ["decision", "tool_selection"],
    description: "Choose an approved action and ask for confirmation.",
  },
  {
    label: "Act",
    stages: ["backend_action", "verification"],
    description: "Run the local booking tools and check the result.",
  },
  {
    label: "Respond",
    stages: ["response", "evaluation"],
    description: "Reply to the customer and record the outcome.",
  },
];
const videoSteps: Record<VideoStage, { label: string; description: string }> = {
  upload: {
    label: "Upload",
    description: "Save the uploaded file to this computer.",
  },
  validation: {
    label: "Validate",
    description: "Inspect video, audio, duration, dimensions, and decoding.",
  },
  extraction: {
    label: "Extract audio",
    description: "Prepare browser playback and its 16 kHz mono audio.",
  },
  recognition: {
    label: "Recognize speech",
    description: "Run the local Whisper model on the actual audio.",
  },
  alignment: {
    label: "Check timestamps",
    description:
      "Validate recognition timestamps against playback. This is not separate forced alignment.",
  },
  ready: {
    label: "Ready",
    description: "Save the real transcript and make downloads available.",
  },
};
function StatusIcon({ status, number }: { status: string; number: number }) {
  return status === "complete" ? (
    <Check size={17} />
  ) : status === "running" ? (
    <Loader2 size={17} className="spin" />
  ) : status === "error" ? (
    <X size={17} />
  ) : (
    <span>{number}</span>
  );
}

export function CallEngine({
  state,
  call,
  onOpen,
}: {
  state: DemoState;
  call?: CallSession;
  onOpen: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const active = call?.activeStage
    ? callSteps.findIndex((s) => s.stages.includes(call.activeStage as Stage))
    : -1;
  const index = selected ?? (active >= 0 ? active : 0);
  const step = callSteps[index];
  const latest = state.events
    .filter((e) => e.callId === call?.id && step.stages.includes(e.stage))
    .at(-1);
  return (
    <>
      <section className="panel simple-pipeline">
        <div className="panel-heading">
          <div>
            <h2>How a call becomes an action</h2>
            <p>Five steps, following the selected conversation.</p>
          </div>
          <button className="text-button" onClick={onOpen}>
            <Phone size={14} />
            Open call
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="simple-steps">
          {callSteps.map((s, i) => {
            const error = s.stages.some(
              (stage) => call?.pipeline[stage].status === "error",
            );
            const status = error
              ? "error"
              : active === i && call?.processing
                ? "running"
                : s.stages.some(
                      (stage) => call?.pipeline[stage].status === "complete",
                    )
                  ? "complete"
                  : "idle";
            return (
              <button
                key={s.label}
                className={`simple-step simple-${status} ${i === index ? "simple-selected" : ""}`}
                onClick={() => setSelected(i)}
                aria-pressed={i === index}
              >
                <span className="simple-step-icon">
                  <StatusIcon status={status} number={i + 1} />
                </span>
                <strong>{s.label}</strong>
                <span>
                  {status === "running"
                    ? "In progress"
                    : status === "complete"
                      ? "Observed"
                      : status === "error"
                        ? "Issue recorded"
                        : "Waiting"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="simple-description">
          <span className="eyebrow">{step.label}</span>
          <h3>{latest?.label || step.description}</h3>
          <p>
            {call
              ? isTerminal(call)
                ? call.evaluation?.suggestion ||
                  "Conversation finished. Its outcome is saved in Results."
                : call.decisionSummary
              : "Start a demo call in Workspace to watch this flow."}
          </p>
          {selected !== null && (
            <button className="text-button" onClick={() => setSelected(null)}>
              Follow current step
            </button>
          )}
        </div>
        <div className="engine-disclosure">
          <span className="source-badge seed">Simulated AI & voice</span>
          <p>
            Typed inputs and rule-based replies drive the demo. Availability
            checks, bookings, verification, and handoffs execute against the
            local backend.
          </p>
        </div>
      </section>
      <details className="technical-details">
        <summary>
          Technical details<span>Stages, agent state, tools, and events</span>
          <ChevronDown size={17} />
        </summary>
        <div className="technical-details-content">
          <Pipeline state={state} call={call} />
          <AgentInspector call={call} />
          <ToolMonitor state={state} call={call} />
          <EventTimeline state={state} call={call} />
        </div>
      </details>
    </>
  );
}

export function VideoEngine({
  job,
  onOpen,
}: {
  job?: VideoJob;
  onOpen: () => void;
}) {
  const [selected, setSelected] = useState<VideoStage | null>(null);
  const stage = selected ?? job?.stage ?? "upload";
  const latest = job?.events.filter((e) => e.stage === stage).at(-1);
  return (
    <>
      <section className="panel simple-pipeline video-pipeline">
        <div className="panel-heading">
          <div>
            <h2>From video to transcript</h2>
            <p>
              {job
                ? job.filename
                : "Upload a video in Workspace to follow its processing."}
            </p>
          </div>
          <button className="text-button" onClick={onOpen}>
            <Video size={14} />
            Open video
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="simple-steps video-steps">
          {VIDEO_STAGES.map((s, i) => {
            const event = job?.events.filter((e) => e.stage === s).at(-1);
            const status =
              event?.kind === "failed"
                ? "error"
                : event?.kind === "completed"
                  ? "complete"
                  : job?.status === "processing" && job.stage === s
                    ? "running"
                    : "idle";
            return (
              <button
                key={s}
                className={`simple-step simple-${status} ${stage === s ? "simple-selected" : ""}`}
                onClick={() => setSelected(s)}
                aria-pressed={stage === s}
              >
                <span className="simple-step-icon">
                  <StatusIcon status={status} number={i + 1} />
                </span>
                <strong>{videoSteps[s].label}</strong>
                <span>
                  {status === "complete"
                    ? "Complete"
                    : status === "running"
                      ? "In progress"
                      : status === "error"
                        ? "Failed"
                        : "Waiting"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="simple-description">
          <span className="eyebrow">{videoSteps[stage].label}</span>
          <h3>{latest?.label || videoSteps[stage].description}</h3>
          <p>{job?.error?.message || videoSteps[stage].description}</p>
          {job?.status === "queued" && (
            <p>
              Queued jobs wait for the local worker. No recognition has been
              claimed yet.
            </p>
          )}
          {job?.status === "deleting" && (
            <p>
              Deletion requested; waiting for the worker to release its files.
            </p>
          )}
          {selected && (
            <button className="text-button" onClick={() => setSelected(null)}>
              Follow current step
            </button>
          )}
        </div>
        <div className="engine-disclosure">
          <span className="source-badge session">Real local ASR</span>
          <p>
            FFmpeg prepares the audio. Whisper recognizes speech on this
            computer. Every step shown is recorded by the upload handler or
            worker.
          </p>
        </div>
      </section>
      <details className="technical-details">
        <summary>
          Technical details
          <span>Recording metadata and actual processing events</span>
          <ChevronDown size={17} />
        </summary>
        <div className="technical-details-content">
          {job ? (
            <>
              <section className="panel video-metadata">
                <div className="panel-heading">
                  <h2>Recording metadata</h2>
                </div>
                <JsonView
                  data={{
                    id: job.id,
                    status: job.status,
                    bytes: job.bytes,
                    duration: job.duration,
                    sourceVideoCodec: job.videoCodec,
                    sourceAudioCodec: job.audioCodec,
                    language: job.language,
                    languageProbability: job.languageProbability,
                    model: job.model,
                    device: job.device,
                    segments: job.segments.length,
                    processingSeconds: job.processingSeconds,
                    attempt: job.attempt,
                    error: job.error,
                  }}
                />
              </section>
              <section className="panel timeline-panel">
                <div className="panel-heading">
                  <h2>Processing events</h2>
                  <span className="count-tag">{job.events.length}</span>
                </div>
                <div className="video-event-list">
                  {job.events.toReversed().map((event) => (
                    <details key={event.id}>
                      <summary>
                        <time>
                          {new Date(event.at).toLocaleTimeString("en-US", {
                            hour12: false,
                          })}
                        </time>
                        <span className={`video-event-kind kind-${event.kind}`}>
                          {event.kind}
                        </span>
                        <strong>{event.label}</strong>
                        <ChevronDown size={14} />
                      </summary>
                      <JsonView data={event.metadata} />
                    </details>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">
              No recording selected. Upload a video to inspect its actual
              events.
            </div>
          )}
        </div>
      </details>
    </>
  );
}
