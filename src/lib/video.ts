export const VIDEO_STAGES = [
  "upload",
  "validation",
  "extraction",
  "recognition",
  "alignment",
  "ready",
] as const;
export type VideoStage = (typeof VIDEO_STAGES)[number];
export type VideoStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "deleting";
export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}
export interface VideoEvent {
  id: string;
  at: string;
  stage: VideoStage;
  kind: "started" | "completed" | "failed" | "recovered";
  label: string;
  metadata: Record<string, unknown>;
}
export interface VideoJob {
  id: string;
  filename: string;
  bytes: number;
  mimeType: string;
  extension: string;
  status: VideoStatus;
  stage: VideoStage;
  createdAt: string;
  updatedAt: string;
  requestedLanguage: "auto" | "en" | "tr";
  language?: string;
  languageProbability?: number;
  duration?: number;
  width?: number;
  height?: number;
  audioCodec?: string;
  videoCodec?: string;
  playbackReady: boolean;
  segments: TranscriptSegment[];
  events: VideoEvent[];
  model?: string;
  device?: string;
  processingSeconds?: number;
  completedAt?: string;
  attempt: number;
  error?: { code: string; message: string; detail?: string };
}
export interface WorkerHealth {
  online: boolean;
  at?: string;
  status?: "ready" | "setup_error";
  pythonVersion?: string;
  fasterWhisperVersion?: string;
  ffmpeg?: boolean;
  ffprobe?: boolean;
  model?: string;
  device?: string;
  error?: string;
}
export interface VideosState {
  jobs: VideoJob[];
  worker: WorkerHealth;
  limits: {
    maxUploadBytes: number;
    maxDurationSeconds: number;
    maxRecordings: number;
  };
}
export function timestamp(seconds: number, millis = false) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const main = `${h > 0 || millis ? `${String(h).padStart(2, "0")}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return millis ? `${main}.${String(total % 1000).padStart(3, "0")}` : main;
}
export function activeSegmentIndex(
  segments: TranscriptSegment[],
  time: number,
) {
  return segments.findIndex((s) => time >= s.start && time < s.end);
}
export function searchSegments(segments: TranscriptSegment[], query: string) {
  const q = query.trim().toLocaleLowerCase();
  return q
    ? segments.filter((s) => s.text.toLocaleLowerCase().includes(q))
    : [];
}
export function exportTranscript(
  segments: TranscriptSegment[],
  format: "txt" | "srt" | "vtt",
) {
  if (format === "txt")
    return (
      segments.map((s) => `[${timestamp(s.start)}] ${s.text}`).join("\n") + "\n"
    );
  const cueText = (text: string) =>
    text.replace(/-->/g, "→").replace(/\s+/g, " ").trim();
  const cueTime = (seconds: number) =>
    format === "srt"
      ? timestamp(seconds, true).replace(".", ",")
      : timestamp(seconds, true);
  const cues = segments
    .map(
      (s, i) =>
        `${i + 1}\n${cueTime(s.start)} --> ${cueTime(s.end)}\n${cueText(s.text)}`,
    )
    .join("\n\n");
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${cues}\n`;
}
export const languageName = (code?: string) =>
  code === "en"
    ? "English"
    : code === "tr"
      ? "Turkish"
      : code
        ? code.toUpperCase()
        : "Detecting…";
export const stageLabel: Record<VideoStage, string> = {
  upload: "Uploaded",
  validation: "Checking your video",
  extraction: "Preparing playback and audio",
  recognition: "Transcribing speech",
  alignment: "Checking timestamps",
  ready: "Transcript ready",
};
