"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileVideo,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  activeSegmentIndex,
  languageName,
  searchSegments,
  stageLabel,
  timestamp,
  VideoJob,
  VideosState,
} from "@/lib/video";

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const target = q.toLocaleLowerCase();
  const parts = [];
  let from = 0;
  let index = lower.indexOf(target);
  while (index >= 0) {
    parts.push(
      text.slice(from, index),
      <mark key={index}>{text.slice(index, index + q.length)}</mark>,
    );
    from = index + q.length;
    index = lower.indexOf(target, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function WorkerNotice({ state }: { state: VideosState | null }) {
  if (!state) return null;
  if (state.worker.online && state.worker.status === "ready")
    return (
      <div className="worker-ready">
        <span className="live-dot" />
        Local transcription ready
        <span>
          Whisper {state.worker.model} · {state.worker.device?.toUpperCase()}
        </span>
      </div>
    );
  return (
    <div className="setup-notice" role="status">
      <strong>
        {state.worker.status === "setup_error" && state.worker.online
          ? "Transcription needs setup"
          : "Local transcription worker is offline"}
      </strong>
      <p>
        {state.worker.online && state.worker.error ? (
          state.worker.error
        ) : (
          <>
            Start Relay with <code>npm run dev:all</code> after installing
            Python and FFmpeg. Uploaded videos stay queued until the worker is
            running.
          </>
        )}
      </p>
      <a href="https://github.com/ismet3547/relay/tree/feat/video-transcription-ux#local-setup">
        View setup instructions
        <ArrowRight size={13} />
      </a>
    </div>
  );
}

type Props = {
  state: VideosState | null;
  job?: VideoJob;
  upload: { filename: string; progress: number } | null;
  busy: boolean;
  onUpload: (file: File, language: "auto" | "en" | "tr") => Promise<void>;
  onSelect: (id: string | null) => void;
  onAction: (id: string, action: "delete" | "retry") => Promise<boolean>;
  onEngine: () => void;
};
export function VideoWorkspace({
  state,
  job,
  upload,
  busy,
  onUpload,
  onSelect,
  onAction,
  onEngine,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<"auto" | "en" | "tr">("auto");
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const deletion = useRef<HTMLDialogElement>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  function choose(files: FileList | File[]) {
    if (upload) return;
    if (files.length !== 1) {
      setLocalError("Choose one video at a time.");
      return;
    }
    setLocalError("");
    void onUpload(files[0], language);
  }
  return (
    <div className="video-workspace">
      <div className="task-toolbar">
        <div>
          <span className="task-icon video-color">
            <FileVideo size={20} />
          </span>
          <div>
            <h2>Video analysis</h2>
            <p>Turn spoken audio into a transcript you can navigate.</p>
          </div>
        </div>
        <div className="toolbar-actions">
          {!!state?.jobs.length && (
            <select
              aria-label="Saved recording"
              value={job?.id || ""}
              onChange={(e) => onSelect(e.target.value || null)}
            >
              <option value="">New recording</option>
              {state.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.filename} · {j.status}
                </option>
              ))}
            </select>
          )}
          {job && (
            <button
              className="button secondary"
              onClick={() => onSelect(null)}
              disabled={!!upload}
            >
              <Upload size={15} />
              New video
            </button>
          )}
        </div>
      </div>
      <WorkerNotice state={state} />
      {localError && (
        <div className="error-banner" role="alert">
          {localError}
          <button aria-label="Dismiss error" onClick={() => setLocalError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {upload ? (
        <section className="panel upload-progress" aria-live="polite">
          <Upload size={28} />
          <h3>Uploading your video</h3>
          <p>{upload.filename}</p>
          <progress value={upload.progress} max="100" />
          <span>
            {upload.progress}% transferred
            {upload.progress === 100 ? " · validating upload…" : ""}
          </span>
          <small>
            Keep Relay open until the upload finishes. Processing continues
            independently afterward.
          </small>
        </section>
      ) : !job ? (
        <section className="panel upload-panel">
          <div className="upload-panel-intro">
            <span className="eyebrow">YOUR VIDEO, YOUR WORDS</span>
            <h3>Watch it. Read it. Find the moment.</h3>
            <p>
              Upload a recording and Relay transcribes its speech locally.
              <br />
              Click any transcript line to jump straight to that moment.
            </p>
          </div>
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files);
            }}
          >
            <span className="upload-icon">
              <Upload size={27} strokeWidth={1.5} />
            </span>
            <h4>Drop a video here</h4>
            <p>or choose a file from your computer</p>
            <button
              className="button primary"
              onClick={() => input.current?.click()}
              disabled={!!upload}
            >
              <FileVideo size={16} />
              Choose video
            </button>
            <input
              ref={input}
              type="file"
              className="visually-hidden"
              aria-label="Choose video"
              accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
              onChange={(e) => {
                if (e.target.files?.length) choose(e.target.files);
                e.target.value = "";
              }}
            />
            <span>
              MP4, MOV, WebM · up to{" "}
              {(state?.limits.maxUploadBytes ?? 104857600) / 1048576} MB ·{" "}
              {(state?.limits.maxDurationSeconds ?? 1800) / 60} minutes
            </span>
          </div>
          <div className="upload-options">
            <label>
              Spoken language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as typeof language)}
              >
                <option value="auto">Detect automatically</option>
                <option value="en">English</option>
                <option value="tr">Turkish</option>
              </select>
            </label>
            <p>
              Videos and transcripts stay on this computer.
              <br />
              No API key or paid transcription service required.
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="recording-heading">
            <div>
              <h3 title={job.filename}>{job.filename}</h3>
              <p>
                {(job.bytes / 1048576).toFixed(1)} MB
                {job.duration ? ` · ${timestamp(job.duration)} recording` : ""}{" "}
                ·{" "}
                {new Date(job.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="recording-actions">
              <button className="button secondary" onClick={onEngine}>
                View processing
                <ArrowRight size={14} />
              </button>
              <button
                className="icon-button danger-button"
                aria-label="Delete recording and transcript"
                disabled={busy || job.status === "deleting"}
                onClick={() => {
                  setDeleteId(job.id);
                  deletion.current?.showModal();
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
          {job.status === "deleting" ? (
            <div className="notice-banner" role="status">
              <Loader2 size={17} className="spin" />
              <span>
                Deletion requested. The worker will stop after its current
                operation and remove the recording and transcript.
              </span>
            </div>
          ) : (
            <VideoReview
              key={job.id}
              job={job}
              busy={busy}
              onRetry={() => void onAction(job.id, "retry")}
              onEngine={onEngine}
            />
          )}
        </>
      )}
      <dialog
        ref={deletion}
        className="reset-dialog"
        aria-labelledby="delete-video-title"
      >
        <div className="dialog-icon">
          <Trash2 size={23} />
        </div>
        <h2 id="delete-video-title">Delete this recording?</h2>
        <p>
          This removes the uploaded video, playback copy, and transcript from
          this computer.
        </p>
        <div>
          <button
            className="button secondary"
            onClick={() => deletion.current?.close()}
          >
            Keep recording
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              deletion.current?.close();
              if (deleteId && (await onAction(deleteId, "delete")))
                onSelect(null);
            }}
          >
            Delete recording
          </button>
        </div>
      </dialog>
    </div>
  );
}

function VideoReview({
  job,
  busy,
  onRetry,
  onEngine,
}: {
  job: VideoJob;
  busy: boolean;
  onRetry: () => void;
  onEngine: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [resultId, setResultId] = useState<number | null>(null);
  const active = activeSegmentIndex(job.segments, time);
  const matches = searchSegments(job.segments, query);
  const selectedMatch = matches.findIndex((s) => s.id === resultId);
  useEffect(() => {
    const box = pane.current;
    const row = active >= 0 ? rows.current.get(job.segments[active].id) : null;
    if (!autoScroll || !box || !row) return;
    box.scrollTo({
      top: Math.max(0, row.offsetTop - box.clientHeight / 3),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [active, autoScroll, job.segments]);
  function seek(start: number, segmentId?: number) {
    if (!player.current) return;
    player.current.currentTime = start;
    setTime(start);
    if (segmentId !== undefined) {
      setResultId(segmentId);
      const row = rows.current.get(segmentId);
      const box = pane.current;
      if (row && box)
        box.scrollTo({
          top: Math.max(0, row.offsetTop - box.clientHeight / 3),
          behavior: "instant",
        });
    }
    void player.current
      .play()
      .catch(() =>
        setMediaError("Press play in the video controls to continue playback."),
      );
  }
  function jump(direction: number) {
    if (matches.length) {
      const index =
        selectedMatch < 0
          ? direction > 0
            ? 0
            : matches.length - 1
          : (selectedMatch + direction + matches.length) % matches.length;
      seek(matches[index].start, matches[index].id);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        job.segments.map((s) => s.text).join("\n"),
      );
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy unavailable. Download TXT instead.");
    }
  }
  const ready = job.status === "completed";
  return (
    <>
      <div className="video-review-grid">
        <div className="player-column">
          <section className="panel player-panel">
            {job.playbackReady ? (
              <>
                <video
                  ref={player}
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/videos/${job.id}/media`}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                  onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
                  onError={() =>
                    setMediaError(
                      "Playback could not load. Refresh this recording or retry it.",
                    )
                  }
                  aria-label={`Video player for ${job.filename}`}
                >
                  {ready && (
                    <track
                      kind="captions"
                      label={languageName(job.language)}
                      srcLang={job.language || "en"}
                      src={`/api/videos/${job.id}/export?format=vtt`}
                    />
                  )}
                </video>
                <div className="player-controls">
                  <span className="mono">
                    {timestamp(time)}{" "}
                    <span>/ {timestamp(job.duration || 0)}</span>
                  </span>
                  <label>
                    Speed
                    <select
                      aria-label="Playback speed"
                      value={speed}
                      onChange={(e) => {
                        const rate = Number(e.target.value);
                        setSpeed(rate);
                        if (player.current) player.current.playbackRate = rate;
                      }}
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}×
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <div className="player-placeholder">
                <FileVideo size={38} strokeWidth={1} />
                <span>Playback appears after video preparation.</span>
              </div>
            )}
            {mediaError && (
              <div className="media-error" role="alert">
                {mediaError}
              </div>
            )}
          </section>
          {!ready && (
            <section
              className={`panel processing-card ${job.status === "failed" ? "processing-failed" : ""}`}
              aria-live="polite"
            >
              <div>
                {job.status === "failed" ? (
                  <X size={22} />
                ) : (
                  <Loader2 size={22} className="spin" />
                )}
                <span className="eyebrow">
                  {job.status === "queued"
                    ? "IN THE LOCAL QUEUE"
                    : job.status === "failed"
                      ? "PROCESSING STOPPED"
                      : "PROCESSING YOUR VIDEO"}
                </span>
              </div>
              <h3>
                {job.status === "failed"
                  ? "We couldn’t finish this video"
                  : job.status === "queued"
                    ? "Waiting for the local worker"
                    : stageLabel[job.stage]}
              </h3>
              <p>
                {job.error?.message ||
                  (job.status === "queued"
                    ? "Recordings are processed one at a time. You can leave this page after uploading."
                    : job.stage === "recognition"
                      ? "Speech is being recognized on this computer. The first run may need to download the model; CPU processing can take a few minutes."
                      : "Relay is processing the actual uploaded file. You can leave this page and return later.")}
              </p>
              {job.status === "failed" && (
                <button
                  className="button secondary"
                  onClick={onRetry}
                  disabled={busy}
                >
                  Retry transcription
                </button>
              )}
              <button className="text-button" onClick={onEngine}>
                Inspect processing steps
                <ArrowRight size={14} />
              </button>
            </section>
          )}
          {ready && (
            <section className="recording-info">
              <span className="success-check">
                <Check size={16} />
                Transcript ready
              </span>
              <dl>
                <div>
                  <dt>Language</dt>
                  <dd>{languageName(job.language)}</dd>
                </div>
                <div>
                  <dt>Segments</dt>
                  <dd>{job.segments.length}</dd>
                </div>
                <div>
                  <dt>Recognition</dt>
                  <dd>
                    Whisper {job.model} · {job.device?.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>Processing time</dt>
                  <dd>{job.processingSeconds}s</dd>
                </div>
              </dl>
              <p>Click a timestamp or transcript line to play that moment.</p>
            </section>
          )}
        </div>
        <section
          className="panel transcript-panel"
          aria-label="Timestamped video transcript"
        >
          <div className="panel-heading">
            <div>
              <h2>Transcript</h2>
              <p>
                {ready
                  ? `${languageName(job.language)} · ${job.segments.length} timestamped segments`
                  : "Your transcript will appear when recognition is complete."}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Copy transcript"
              title="Copy transcript"
              disabled={!ready}
              onClick={copy}
            >
              {copyStatus === "Copied" ? (
                <Check size={17} />
              ) : (
                <Copy size={17} />
              )}
            </button>
          </div>
          <div className="transcript-search">
            <Search size={16} />
            <input
              aria-label="Search transcript"
              placeholder="Search transcript…"
              value={query}
              disabled={!ready}
              onChange={(e) => {
                setQuery(e.target.value);
                setResultId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jump(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear transcript search"
                onClick={() => {
                  setQuery("");
                  setResultId(null);
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {query && (
            <div className="search-results" aria-live="polite">
              <span>
                {matches.length
                  ? `${selectedMatch >= 0 ? `${selectedMatch + 1} of ` : ""}${matches.length} matching segment${matches.length === 1 ? "" : "s"}`
                  : "No matching words"}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous search result"
                  disabled={!matches.length}
                  onClick={() => jump(-1)}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next search result"
                  disabled={!matches.length}
                  onClick={() => jump(1)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>
          )}
          <div className="transcript-options">
            <label>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Follow playback
            </label>
            {ready && <span>Click a line to seek</span>}
          </div>
          <div className="video-transcript-lines" ref={pane}>
            {ready ? (
              job.segments.map((segment, index) => (
                <button
                  ref={(element) => {
                    if (element) rows.current.set(segment.id, element);
                    else rows.current.delete(segment.id);
                  }}
                  key={segment.id}
                  className={`video-transcript-line ${active === index ? "line-active" : ""} ${matches.some((s) => s.id === segment.id) ? "line-match" : ""} ${segment.id === resultId ? "line-result" : ""}`}
                  aria-current={active === index ? "true" : undefined}
                  aria-label={`${timestamp(segment.start)}: ${segment.text}`}
                  onClick={() => seek(segment.start, segment.id)}
                >
                  <time>{timestamp(segment.start)}</time>
                  <span>
                    <Highlight text={segment.text} query={query} />
                  </span>
                </button>
              ))
            ) : (
              <div className="transcript-waiting">
                <span className="transcript-ghost">
                  <i />
                  <i />
                  <i />
                </span>
                <h3>
                  {job.status === "failed"
                    ? "No transcript available"
                    : "Listening comes next"}
                </h3>
                <p>
                  {job.status === "failed"
                    ? "Fix the processing issue and retry to generate a real transcript."
                    : "This panel uses the speech and timestamps returned by the local recognizer."}
                </p>
              </div>
            )}
          </div>
          <div className="transcript-downloads">
            <span>
              <ArrowDownToLine size={14} />
              Download
            </span>
            {(["txt", "srt", "vtt"] as const).map((format) =>
              ready ? (
                <a
                  className="export-link"
                  key={format}
                  href={`/api/videos/${job.id}/export?format=${format}`}
                  download
                >
                  {format.toUpperCase()}
                </a>
              ) : (
                <span className="export-link disabled" key={format}>
                  {format.toUpperCase()}
                </span>
              ),
            )}
          </div>
          {copyStatus && (
            <div className="copy-status" role="status">
              {copyStatus}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
