import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import config from "../../config/transcription.json";
import { VideoJob, VideosState, WorkerHealth } from "../lib/video";
import { DemoError } from "./errors";

export { config as videoConfig };
export function videoRoot() {
  const dir = path.resolve(
    /* turbopackIgnore: true */ process.env.RELAY_DATA_DIR ||
      path.join(process.cwd(), ".relay-data"),
  );
  fs.mkdirSync(path.join(dir, "videos"), { recursive: true, mode: 0o700 });
  return dir;
}
export function jobDirectory(id: string) {
  if (!/^vid_[a-f0-9]{32}$/.test(id))
    throw new DemoError("VIDEO_NOT_FOUND", "Recording not found.", 404);
  return path.join(videoRoot(), "videos", id);
}
export function readJob(id: string): VideoJob {
  const dir = jobDirectory(id);
  const file = path.join(dir, "job.json");
  if (!fs.existsSync(file))
    throw new DemoError(
      "VIDEO_NOT_FOUND",
      "This recording no longer exists.",
      404,
    );
  const job = JSON.parse(fs.readFileSync(file, "utf8")) as VideoJob;
  if (fs.existsSync(path.join(dir, ".delete")))
    return { ...job, status: "deleting" };
  return job;
}
export function writeJob(job: VideoJob) {
  const dir = jobDirectory(job.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `job-${randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(temp, path.join(dir, "job.json"));
}
export function videoState(): VideosState {
  const dir = path.join(videoRoot(), "videos");
  const jobs = fs
    .readdirSync(dir)
    .filter((n) => /^vid_[a-f0-9]{32}$/.test(n))
    .flatMap((id) => {
      try {
        return [readJob(id)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let worker: WorkerHealth = { online: false };
  try {
    const health = JSON.parse(
      fs.readFileSync(path.join(videoRoot(), "worker.json"), "utf8"),
    );
    worker = { ...health, online: Date.now() - Date.parse(health.at) < 8000 };
    // Never expose process IDs or local filesystem paths to the browser.
    delete (worker as unknown as Record<string, unknown>).pid;
  } catch {
    /* No active worker. */
  }
  return {
    jobs,
    worker,
    limits: {
      maxUploadBytes: config.maxUploadBytes,
      maxDurationSeconds: config.maxDurationSeconds,
      maxRecordings: config.maxRecordings,
    },
  };
}
export function deleteJob(id: string) {
  const job = readJob(id);
  const dir = jobDirectory(id);
  if (
    job.status === "processing" ||
    fs.existsSync(path.join(dir, ".processing"))
  ) {
    fs.writeFileSync(path.join(dir, ".delete"), "", { mode: 0o600 });
    return { deleting: true };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleting: false };
}
export function retryJob(id: string) {
  const job = readJob(id);
  if (
    job.status !== "failed" ||
    fs.existsSync(path.join(jobDirectory(id), ".processing"))
  )
    throw new DemoError(
      "VIDEO_BUSY",
      "Only a finished failed job can be retried.",
      409,
    );
  const updated = {
    ...job,
    status: "queued" as const,
    stage: "validation" as const,
    updatedAt: new Date().toISOString(),
    error: undefined,
    segments: [],
    attempt: job.attempt + 1,
  };
  updated.events.push({
    id: randomUUID(),
    at: updated.updatedAt,
    stage: "validation",
    kind: "recovered",
    label: "Retry requested by the user",
    metadata: { attempt: updated.attempt },
  });
  writeJob(updated);
  return updated;
}
