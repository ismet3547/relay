"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blocks,
  Check,
  FileVideo,
  LayoutDashboard,
  Loader2,
  Pause,
  Phone,
  Play,
  RotateCcw,
  Settings2,
  Wrench,
  X,
} from "lucide-react";
import { useDemo } from "@/hooks/use-demo";
import { useVideos } from "@/hooks/use-videos";
import { Scenario, isTerminal } from "@/lib/types";
import { timestamp } from "@/lib/video";
import { CallConsole } from "./call-console";
import { CallEngine, VideoEngine } from "./simple-engine";
import { Activity, Appointments } from "./operations";
import { CallResult } from "./call-result";
import { VideoWorkspace } from "./video-workspace";

function subscribeLocation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}
function currentRecording() {
  const id = new URLSearchParams(window.location.search).get("recording");
  return id && /^vid_[a-f0-9]{32}$/.test(id) ? id : null;
}
function rememberRecording(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("recording", id);
  else url.searchParams.delete("recording");
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Workspace() {
  const demo = useDemo();
  const videos = useVideos();
  const { state, connected, action, pending } = demo;
  const [view, setView] = useState<"workspace" | "engine">("workspace");
  const recordingFromUrl = useSyncExternalStore(
    subscribeLocation,
    currentRecording,
    () => null,
  );
  const [taskOverride, updateTask] = useState<
    "home" | "call" | "video" | "results" | null
  >(null);
  const task = taskOverride ?? (recordingFromUrl ? "video" : "home");
  function setTask(next: "home" | "call" | "video" | "results") {
    updateTask(next);
    if (next !== "video") rememberRecording(null);
  }
  const [engineMode, setEngineMode] = useState<"call" | "video">("call");
  const [resultTab, setResultTab] = useState<
    "calls" | "appointments" | "videos"
  >("calls");
  const [scenario, setScenario] = useState<Scenario>("appointment");
  const [selectedId, setSelectedId] = useState<string>("new");
  const [selectedVideoId, setSelectedVideoId] = useState<
    string | null | undefined
  >(undefined);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const activeCall = state?.calls.find(
    (c) => c.source === "session" && !isTerminal(c),
  );
  const selectedCall =
    selectedId === "new"
      ? undefined
      : (state?.calls.find((c) => c.id === selectedId) ?? activeCall);
  const targetVideoId = selectedVideoId ?? recordingFromUrl;
  const selectedVideo =
    selectedVideoId === null
      ? undefined
      : targetVideoId
        ? videos.state?.jobs.find((j) => j.id === targetVideoId)
        : videos.state?.jobs[0];
  const processingVideos =
    videos.state?.jobs.filter((j) =>
      ["queued", "processing"].includes(j.status),
    ) || [];
  async function start() {
    const result = await action("/api/calls", { scenario });
    if (result?.call) setSelectedId(result.call.id);
  }
  async function send(text: string) {
    if (!selectedCall) return false;
    return !!(await action(`/api/calls/${selectedCall.id}/input`, {
      text,
      messageId: crypto.randomUUID(),
    }));
  }
  function selectCall(id: string) {
    setSelectedId(id);
    const call = state?.calls.find((c) => c.id === id);
    if (call) setScenario(call.scenario);
    setTask("call");
    setView("workspace");
  }
  function selectVideo(id: string) {
    setSelectedVideoId(id);
    rememberRecording(id);
    setTask("video");
    setView("workspace");
  }
  function openEngine(mode: "call" | "video") {
    setEngineMode(mode);
    setView("engine");
  }
  function runCall() {
    setSelectedId(activeCall?.id || "new");
    setTask("call");
    setView("workspace");
  }
  const consoleProps = state
    ? {
        state,
        call: selectedCall,
        scenario: selectedCall && activeCall ? selectedCall.scenario : scenario,
        setScenario,
        busy: pending,
        connected,
        onStart: start,
        onSend: send,
        onEnd: () => {
          if (selectedCall)
            void action(`/api/calls/${selectedCall.id}/end`, {});
        },
      }
    : null;
  const taskTitle =
    task === "home"
      ? "What would you like to do?"
      : task === "call"
        ? "One conversation. A clear result."
        : task === "video"
          ? "Find the words. Find the moment."
          : "Your work, saved here.";
  return (
    <div className="app-shell relay-app">
      <aside className="sidebar">
        <button
          className="brand brand-button"
          onClick={() => {
            setView("workspace");
            setTask("home");
          }}
          aria-label="Relay home"
        >
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <span>
            relay<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-card">
          <span className="business-icon">
            <Wrench size={19} />
          </span>
          <div>
            <strong>Northline Auto</strong>
            <span>Local workspace</span>
          </div>
        </div>
        <div className="sidebar-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={view === "workspace" ? "nav-active" : ""}
            onClick={() => {
              setView("workspace");
              setTask("home");
            }}
            aria-current={view === "workspace" ? "page" : undefined}
          >
            <LayoutDashboard size={19} />
            <span>Workspace</span>
            {(activeCall || processingVideos.length > 0) && (
              <span className="nav-live-dot" />
            )}
          </button>
          <button
            className={view === "engine" ? "nav-active" : ""}
            onClick={() => {
              if (task === "video") setEngineMode("video");
              else if (task === "call") setEngineMode("call");
              setView("engine");
            }}
            aria-current={view === "engine" ? "page" : undefined}
          >
            <Blocks size={19} />
            <span>AI Engine</span>
          </button>
        </nav>
        <div className="sidebar-environment">
          <span className="eyebrow">RUNS ON YOUR COMPUTER</span>
          <h3>Your recordings stay local.</h3>
          <p>
            Real video transcription.
            <br />
            Interactive call simulation.
          </p>
          <div>
            <span className="live-dot" />
            No paid API required
          </div>
        </div>
        <div className="sidebar-bottom">
          <span className="operator-avatar">AM</span>
          <div>
            <strong>Alex Morgan</strong>
            <span>Workspace operator</span>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Northline Auto</span>
            <span>/</span>
            <strong>{view === "engine" ? "AI Engine" : "Workspace"}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`connection-status ${connected ? "connected" : ""}`}
            >
              <span className={connected ? "live-dot" : "warning-dot"} />
              {connected ? "Connected locally" : "Reconnecting…"}
            </span>
            <details className="workspace-settings">
              <summary aria-label="Workspace settings">
                <Settings2 size={17} />
                <span>Settings</span>
              </summary>
              <div>
                {state && (
                  <button
                    disabled={pending || !connected}
                    onClick={() =>
                      action(
                        "/api/demo",
                        { agentActive: !state.agentActive },
                        "PATCH",
                      )
                    }
                  >
                    {state.agentActive ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                    {state.agentActive
                      ? "Pause new demo calls"
                      : "Resume demo calls"}
                  </button>
                )}
                <button
                  disabled={!state || pending || !connected}
                  onClick={() => resetDialog.current?.showModal()}
                >
                  <RotateCcw size={15} />
                  Reset call demo
                </button>
              </div>
            </details>
          </div>
        </header>
        <main>
          {view === "workspace" && task !== "home" && (
            <button className="back-button" onClick={() => setTask("home")}>
              <ArrowLeft size={15} />
              Back to workspace
            </button>
          )}
          <div className="page-heading">
            <div>
              <div className="section-kicker">
                {view === "engine" ? "BEHIND THE ACTION" : "WORKSPACE"}
              </div>
              <h1>{view === "engine" ? "See how it happens." : taskTitle}</h1>
              <p>
                {view === "engine"
                  ? "Follow each step. Open the details when you need them."
                  : task === "home"
                    ? "Choose a workflow. Relay takes care of the next steps."
                    : task === "call"
                      ? "Play the customer and watch a service request become a verified operation."
                      : task === "video"
                        ? "Upload a video, then explore its real spoken transcript."
                        : "Review conversations, appointments, and video transcripts."}
              </p>
            </div>
          </div>
          {demo.error && (
            <div className="error-banner" role="alert">
              <span>{demo.error}</span>
              <button
                className="icon-button"
                onClick={demo.clearError}
                aria-label="Dismiss call error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {videos.error && (
            <div className="error-banner" role="alert">
              <span>{videos.error}</span>
              <button
                className="icon-button"
                onClick={videos.clearError}
                aria-label="Dismiss video error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {state && !state.agentActive && (
            <div className="notice-banner">
              <Pause size={16} />
              <span>New demo calls are paused.</span>
              <button
                className="text-button"
                disabled={pending || !connected}
                onClick={() =>
                  action("/api/demo", { agentActive: true }, "PATCH")
                }
              >
                Resume calls
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!state || !consoleProps ? (
            <div className="loading-workspace">
              <Loader2 className="spin" size={25} />
              <h2>Opening your workspace</h2>
              <p>Connecting to the local system…</p>
            </div>
          ) : view === "engine" ? (
            <>
              <div className="engine-toolbar">
                <div className="segmented-control" aria-label="Engine workflow">
                  <button
                    className={engineMode === "call" ? "selected" : ""}
                    aria-pressed={engineMode === "call"}
                    onClick={() => setEngineMode("call")}
                  >
                    <Phone size={15} />
                    Demo call
                  </button>
                  <button
                    className={engineMode === "video" ? "selected" : ""}
                    aria-pressed={engineMode === "video"}
                    onClick={() => setEngineMode("video")}
                  >
                    <FileVideo size={15} />
                    Video transcription
                  </button>
                </div>
                {engineMode === "call" ? (
                  <select
                    aria-label="Call to inspect"
                    value={selectedCall?.id || "new"}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    <option value="new">No call selected</option>
                    {state.calls.map((c) => (
                      <option key={c.id} value={c.id}>
                        {
                          state.customers.find((x) => x.id === c.customerId)
                            ?.name
                        }{" "}
                        · {c.status}
                        {c.source === "seed" ? " (example)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    aria-label="Video to inspect"
                    value={selectedVideo?.id || ""}
                    onChange={(e) => setSelectedVideoId(e.target.value || null)}
                  >
                    <option value="">No recording selected</option>
                    {videos.state?.jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.filename} · {j.status}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {engineMode === "call" ? (
                <CallEngine
                  state={state}
                  call={selectedCall}
                  onOpen={() => {
                    setView("workspace");
                    setTask("call");
                  }}
                />
              ) : (
                <VideoEngine
                  key={selectedVideo?.id || "none"}
                  job={selectedVideo}
                  onOpen={() => {
                    setView("workspace");
                    setTask("video");
                  }}
                />
              )}
            </>
          ) : task === "home" ? (
            <>
              <div className="workflow-cards">
                <button
                  className="workflow-card call-workflow"
                  onClick={runCall}
                >
                  <span className="workflow-top">
                    <span className="workflow-icon">
                      <Phone size={26} strokeWidth={1.5} />
                    </span>
                    <span className="workflow-badge">Interactive demo</span>
                  </span>
                  <h2>Run Demo Call</h2>
                  <p>
                    Meet Nova, your service assistant.
                    <br />
                    Book an appointment or try a handoff.
                  </p>
                  <span className="workflow-steps">
                    Choose a scenario<span>→</span>Reply as customer
                    <span>→</span>See the result
                  </span>
                  <span className="workflow-cta">
                    {activeCall ? "Continue your call" : "Try a conversation"}
                    <ArrowRight size={19} />
                  </span>
                </button>
                <button
                  className="workflow-card video-workflow"
                  onClick={() => {
                    setTask("video");
                    setSelectedVideoId(null);
                    rememberRecording(null);
                  }}
                >
                  <span className="workflow-top">
                    <span className="workflow-icon">
                      <FileVideo size={27} strokeWidth={1.5} />
                    </span>
                    <span className="workflow-badge">Real transcription</span>
                  </span>
                  <h2>Analyze Video</h2>
                  <p>
                    Your recording, turned into readable words.
                    <br />
                    Search the transcript and jump to any moment.
                  </p>
                  <span className="workflow-steps">
                    Upload video<span>→</span>Transcribe locally<span>→</span>
                    Watch & read
                  </span>
                  <span className="workflow-cta">
                    Choose your video
                    <ArrowRight size={19} />
                  </span>
                </button>
              </div>
              {(activeCall || processingVideos.length > 0 || videos.upload) && (
                <div className="in-progress-work">
                  <span className="eyebrow">IN PROGRESS</span>
                  {activeCall && (
                    <button onClick={() => selectCall(activeCall.id)}>
                      <span className="live-dot" />
                      <strong>Your demo call is still open</strong>
                      <span>Continue conversation</span>
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {videos.upload && (
                    <button onClick={() => setTask("video")}>
                      <Loader2 size={15} className="spin" />
                      <strong>{videos.upload.filename}</strong>
                      <span>Uploading · {videos.upload.progress}%</span>
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {processingVideos.map((j) => (
                    <button key={j.id} onClick={() => selectVideo(j.id)}>
                      <Loader2 size={15} className="spin" />
                      <strong>{j.filename}</strong>
                      <span>
                        {j.status === "queued"
                          ? "In the queue"
                          : "Processing locally"}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              <section className="recent-work">
                <div className="recent-heading">
                  <div>
                    <h2>Results & activity</h2>
                    <p>Pick up where you left off.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setTask("results")}
                  >
                    View all results
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="recent-list">
                  {videos.state?.jobs
                    .filter((j) => !["queued", "processing"].includes(j.status))
                    .slice(0, 2)
                    .map((j) => (
                      <button key={j.id} onClick={() => selectVideo(j.id)}>
                        <span className="recent-icon video-color">
                          <FileVideo size={19} />
                        </span>
                        <div>
                          <strong>{j.filename}</strong>
                          <span>
                            Video transcript ·{" "}
                            {j.status === "completed"
                              ? `${j.segments.length} segments`
                              : j.status}
                          </span>
                        </div>
                        <span
                          className={
                            j.status === "completed" ? "positive" : "muted"
                          }
                        >
                          {j.status === "completed" ? (
                            <Check size={16} />
                          ) : (
                            j.status
                          )}
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  {state.calls.slice(0, 3).map((c) => (
                    <button key={c.id} onClick={() => selectCall(c.id)}>
                      <span className="recent-icon">
                        <Phone size={18} />
                      </span>
                      <div>
                        <strong>
                          {
                            state.customers.find((x) => x.id === c.customerId)
                              ?.name
                          }
                        </strong>
                        <span>
                          {c.intent}
                          {c.source === "seed" ? " · Example" : ""}
                        </span>
                      </div>
                      <span className="recent-outcome">
                        {c.bookingId
                          ? "Appointment saved"
                          : c.handoffId
                            ? "Human handoff"
                            : c.status === "escalated"
                              ? "Human handoff"
                              : c.status}
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              </section>
              <div className="home-explainer">
                <Blocks size={21} />
                <div>
                  <strong>Curious about what happens behind the scenes?</strong>
                  <p>
                    The AI Engine explains each step and shows the actions Relay
                    actually runs.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setView("engine")}
                >
                  Explore the engine
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : task === "call" ? (
            <>
              {activeCall && selectedCall?.id !== activeCall.id && (
                <div className="notice-banner">
                  <span>A call is still running.</span>
                  <button
                    className="text-button"
                    onClick={() => selectCall(activeCall.id)}
                  >
                    Return to live call
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
              <div className="operations-grid">
                <CallConsole
                  {...consoleProps}
                  onEngine={() => openEngine("call")}
                />
                <CallResult
                  state={state}
                  call={selectedCall}
                  onEngine={() => openEngine("call")}
                />
              </div>
            </>
          ) : task === "video" ? (
            <VideoWorkspace
              state={videos.state}
              job={selectedVideo}
              upload={videos.upload}
              busy={videos.busy}
              onSelect={(id) => {
                setSelectedVideoId(id);
                rememberRecording(id);
              }}
              onAction={videos.action}
              onUpload={async (file, language) => {
                const job = await videos.uploadFile(file, language);
                if (job) {
                  setSelectedVideoId(job.id);
                  rememberRecording(job.id);
                }
              }}
              onEngine={() => openEngine("video")}
            />
          ) : (
            <>
              <div
                className="results-tabs segmented-control"
                aria-label="Results category"
              >
                {(
                  [
                    ["calls", "Conversations", Phone],
                    ["appointments", "Appointments", Check],
                    ["videos", "Video transcripts", FileVideo],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    className={resultTab === key ? "selected" : ""}
                    aria-pressed={resultTab === key}
                    onClick={() => setResultTab(key)}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              {resultTab === "calls" ? (
                <Activity
                  state={state}
                  selectedId={selectedCall?.id}
                  onSelect={selectCall}
                />
              ) : resultTab === "appointments" ? (
                <Appointments state={state} onSelect={selectCall} />
              ) : (
                <section className="panel recordings-results">
                  <div className="panel-heading">
                    <div>
                      <h2>Your recordings</h2>
                      <p>
                        Saved locally with their transcripts and processing
                        status.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setTask("video");
                        setSelectedVideoId(null);
                        rememberRecording(null);
                      }}
                    >
                      Analyze video
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="recent-list">
                    {videos.state?.jobs.length ? (
                      videos.state.jobs.map((j) => (
                        <button key={j.id} onClick={() => selectVideo(j.id)}>
                          <span className="recent-icon video-color">
                            <FileVideo size={18} />
                          </span>
                          <div>
                            <strong>{j.filename}</strong>
                            <span>
                              {j.duration
                                ? timestamp(j.duration)
                                : "Duration pending"}{" "}
                              ·{" "}
                              {j.status === "completed"
                                ? `${j.segments.length} segments`
                                : j.status}
                            </span>
                          </div>
                          <span className="recent-outcome">
                            {j.status === "completed"
                              ? "Transcript ready"
                              : j.status}
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))
                    ) : (
                      <div className="empty-state">
                        <h3>Your first transcript starts with a video.</h3>
                        <p>Choose Analyze Video to upload a recording.</p>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              <ActivityIcon size={13} />
              Relay · local workspace
            </span>
            <span>Northline Auto is fictional · appointment times in UTC</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={resetDialog}
        className="reset-dialog"
        aria-labelledby="reset-title"
      >
        <div className="dialog-icon">
          <RotateCcw size={23} />
        </div>
        <h2 id="reset-title">Reset the call demo?</h2>
        <p>
          This clears new demo calls, appointments, handoffs, and events, then
          restores the example scenarios. Your video recordings are kept.
        </p>
        <div>
          <button
            className="button secondary"
            onClick={() => resetDialog.current?.close()}
          >
            Keep working
          </button>
          <button
            className="button primary"
            onClick={async () => {
              resetDialog.current?.close();
              const result = await action("/api/demo/reset", {});
              if (result) {
                setSelectedId("new");
                setScenario("appointment");
              }
            }}
          >
            Reset demo
          </button>
        </div>
      </dialog>
    </div>
  );
}
