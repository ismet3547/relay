import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

// Real ASR integration test; fixture, media, models, and transcripts are never committed.
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-real-asr-"));
const data = path.join(temp, "data");
const port = Number(process.env.TEST_VIDEO_PORT || 3102);
const base = `http://127.0.0.1:${port}`;
const python =
  process.env.RELAY_PYTHON ||
  path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const model =
  process.env.RELAY_MODEL_PATH || path.join(root, ".relay-data/models/base");
const env = {
  ...process.env,
  RELAY_DATA_DIR: data,
  RELAY_MODEL_PATH: model,
  DEMO_DATA_DIR: path.join(temp, "calls"),
  DEMO_STEP_MS: "10",
  NEXT_TELEMETRY_DISABLED: "1",
};
const successes = [];
let server;
let worker;
let logs = "";
function command(tool, args) {
  const result = spawnSync(tool, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.status !== 0)
    throw new Error(`${tool} failed: ${result.stderr || result.error}`);
}
function attach(child) {
  child.stdout.on("data", (d) => {
    logs += d.toString();
  });
  child.stderr.on("data", (d) => {
    logs += d.toString();
  });
  return child;
}
async function stop(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(signal);
  await Promise.race([
    exited,
    wait(8000).then(() => {
      child.kill("SIGKILL");
      return exited;
    }),
  ]);
}
async function startServer() {
  server = attach(
    spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, "Next exited unexpectedly");
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Starting. */
    }
    await wait(100);
  }
  throw new Error("Server readiness timeout");
}
async function api(url, init = {}, origin = base) {
  const response = await fetch(origin + url, {
    ...init,
    headers: { Origin: origin, ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
const state = async () => (await api("/api/videos")).body;
const getJob = async (id) => (await api(`/api/videos/${id}`)).body.job;
function startWorker() {
  worker = attach(
    spawn(python, ["transcription/worker.py"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
async function until(fn, limit = 180000, interval = 150) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    const result = await fn();
    if (result) return result;
    await wait(interval);
  }
  throw new Error(
    "Timed out waiting for real processing: " + logs.slice(-2000),
  );
}
async function upload(filename, language = "auto", origin = base) {
  const ext = path.extname(filename);
  const mime =
    ext === ".webm"
      ? "video/webm"
      : ext === ".mov"
        ? "video/quicktime"
        : "video/mp4";
  const form = new FormData();
  form.set("language", language);
  form.set(
    "video",
    new Blob([fs.readFileSync(filename)], { type: mime }),
    path.basename(filename),
  );
  const result = await api("/api/videos", { method: "POST", body: form }, origin);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.job;
}
async function finished(id) {
  return until(async () => {
    const job = await getJob(id);
    return ["completed", "failed"].includes(job.status) && job;
  }, 180000);
}
const ffmpeg = (args) =>
  command("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-threads",
    "2",
    "-filter_threads",
    "2",
    ...args,
  ]);
try {
  const speech = process.env.RELAY_TEST_SPEECH || path.join(temp, "jfk.flac");
  if (!process.env.RELAY_TEST_SPEECH)
    command("curl", [
      "--fail",
      "-L",
      "--max-time",
      "60",
      "https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/tests/data/jfk.flac",
      "-o",
      speech,
    ]);
  const mp4 = path.join(temp, "real-speech.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x172132:s=640x360:r=24",
    "-i",
    speech,
    "-af",
    "adelay=3000:all=1",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-t",
    "14",
    mp4,
  ]);
  const mov = path.join(temp, "real-speech.mov");
  ffmpeg(["-i", mp4, "-c", "copy", mov]);
  const webm = path.join(temp, "real-speech.webm");
  ffmpeg([
    "-i",
    mp4,
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-c:a",
    "libopus",
    webm,
  ]);
  const noAudio = path.join(temp, "no-audio.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=10",
    "-t",
    "1",
    "-an",
    "-c:v",
    "libx264",
    noAudio,
  ]);
  const silent = path.join(temp, "silent.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=10",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    silent,
  ]);
  await startServer();
  assert.equal((await state()).worker.online, false);
  const first = await upload(mp4);
  assert.equal(first.status, "queued");
  assert.deepEqual(first.segments, []);
  await stop(server);
  await startServer();
  assert.equal((await getJob(first.id)).status, "queued");
  successes.push(
    "Upload is durably queued while worker is offline and survives HTTP server restart",
  );
  startWorker();
  await until(async () => (await state()).worker.online);
  const transcript = await finished(first.id);
  assert.equal(
    transcript.status,
    "completed",
    JSON.stringify(transcript.error),
  );
  assert.equal(transcript.language, "en");
  assert.ok(transcript.segments.length > 0);
  const text = transcript.segments
    .map((s) => s.text)
    .join(" ")
    .toLowerCase();
  assert.match(text, /ask not what your country/);
  assert.match(text, /what you can do for your country/);
  assert.ok(
    transcript.segments[0].start >= 2.5,
    "Recognition must preserve the known three seconds of leading silence",
  );
  let previous = 0;
  for (const segment of transcript.segments) {
    assert.ok(
      segment.start >= previous &&
        segment.end > segment.start &&
        segment.end <= transcript.duration,
    );
    previous = segment.end;
  }
  for (const stage of [
    "upload",
    "validation",
    "extraction",
    "recognition",
    "alignment",
    "ready",
  ])
    assert.ok(
      transcript.events.some(
        (e) => e.stage === stage && e.kind === "completed",
      ),
      stage,
    );
  assert.equal(
    fs.existsSync(path.join(data, "videos", first.id, "audio.wav")),
    false,
  );
  console.log(
    `REAL ASR: ${transcript.language}, ${transcript.segments.length} segments, first timestamp ${transcript.segments[0].start}s, ${transcript.processingSeconds}s processing`,
  );
  successes.push(
    "Real MP4 speech is recognized by local Whisper; actual timestamps preserve leading silence; all six stages complete; extracted audio is cleaned",
  );
  const media = await fetch(base + `/api/videos/${first.id}/media`, {
    headers: { Range: "bytes=10-109" },
  });
  assert.equal(media.status, 206);
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  assert.match(media.headers.get("content-range"), /^bytes 10-109\//);
  assert.equal(
    (
      await fetch(base + `/api/videos/${first.id}/media`, {
        headers: { Range: "bytes=999999999-" },
      })
    ).status,
    416,
  );
  for (const format of ["txt", "srt", "vtt"]) {
    const response = await fetch(
      base + `/api/videos/${first.id}/export?format=${format}`,
    );
    assert.equal(response.status, 200);
    const exported = await response.text();
    assert.match(exported.toLowerCase(), /country/);
    if (format === "vtt") assert.ok(exported.startsWith("WEBVTT"));
    if (format === "srt") assert.match(exported, /\d\d:\d\d:\d\d,\d{3} -->/);
  }
  await stop(server);
  await startServer();
  assert.deepEqual((await getJob(first.id)).segments, transcript.segments);
  successes.push(
    "Byte-range playback seeks, all three real transcript exports, and completed transcript persistence pass",
  );
  // Interrupt real processing and confirm the next worker recovers the actual uploaded source.
  await stop(worker);
  const second = await upload(mov, "en");
  startWorker();
  await until(
    async () => {
      const job = await getJob(second.id);
      return job.status === "processing" && job.stage === "recognition";
    },
    30000,
    30,
  );
  await stop(worker, "SIGKILL");
  assert.equal((await getJob(second.id)).status, "processing");
  startWorker();
  const recovered = await finished(second.id);
  assert.equal(recovered.status, "completed", JSON.stringify(recovered.error));
  assert.ok(recovered.events.some((e) => e.kind === "recovered"));
  assert.match(
    recovered.segments
      .map((s) => s.text)
      .join(" ")
      .toLowerCase(),
    /country/,
  );
  successes.push(
    "An interrupted MOV transcription recovers from disk after worker restart and transcribes the real audio",
  );
  const third = await upload(webm, "auto", `http://localhost:${port}`);
  const converted = await finished(third.id);
  assert.equal(converted.status, "completed", JSON.stringify(converted.error));
  assert.equal(converted.language, "en");
  successes.push(
    "Localhost browser-origin upload accepts WebM/Opus and transcribes its real audio",
  );
  await stop(worker);
  const deleting = await upload(mp4, "en");
  startWorker();
  await until(
    async () => {
      const job = await getJob(deleting.id);
      return job.status === "processing" && job.stage === "recognition";
    },
    30000,
    30,
  );
  const deletion = await api(`/api/videos/${deleting.id}`, {
    method: "DELETE",
  });
  assert.equal(deletion.status, 200);
  assert.equal(deletion.body.deleting, true);
  await until(
    async () => (await api(`/api/videos/${deleting.id}`)).status === 404,
  );
  assert.equal(fs.existsSync(path.join(data, "videos", deleting.id)), false);
  successes.push(
    "Deleting a live recognition job stops at a safe boundary and removes its media and temporary audio",
  );
  const noAudioJob = await finished((await upload(noAudio)).id);
  assert.equal(noAudioJob.error.code, "NO_AUDIO");
  assert.equal(noAudioJob.status, "failed");
  const silentJob = await finished((await upload(silent)).id);
  assert.equal(silentJob.error.code, "NO_SPEECH");
  assert.deepEqual(silentJob.segments, []);
  const corrupt = path.join(temp, "corrupt.mp4");
  fs.writeFileSync(
    corrupt,
    Buffer.from("000000206674797069736f6d00000200", "hex"),
  );
  const corruptJob = await finished((await upload(corrupt)).id);
  assert.equal(corruptJob.error.code, "VIDEO_DECODE_FAILED");
  const fake = new FormData();
  fake.set(
    "video",
    new Blob(["not a video"], { type: "video/mp4" }),
    "fake.mp4",
  );
  assert.equal(
    (await api("/api/videos", { method: "POST", body: fake })).status,
    415,
  );
  for (const origin of ["https://elsewhere.test", `http://localhost:${port}`]) {
    for (const [url, method, body] of [
      ["/api/videos", "POST", fake],
      [`/api/videos/${noAudioJob.id}/retry`, "POST", undefined],
      [`/api/videos/${first.id}`, "DELETE", undefined],
    ]) {
      const crossed = await api(url, { method, body, headers: { Origin: origin } });
      assert.equal(crossed.status, 403);
      assert.equal(crossed.body.code, "ORIGIN_REJECTED");
    }
  }
  assert.equal((await getJob(noAudioJob.id)).status, "failed");
  assert.equal((await getJob(first.id)).status, "completed");
  successes.push(
    "No-audio, silent-speech, corrupt-decode, fake-signature, and cross-origin failure paths return safe errors with no fabricated text",
  );
  const retry = await api(`/api/videos/${noAudioJob.id}/retry`, {
    method: "POST",
  });
  assert.equal(retry.status, 200);
  assert.equal((await finished(noAudioJob.id)).error.code, "NO_AUDIO");
  assert.equal(
    (await api(`/api/videos/${first.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await api(`/api/videos/${first.id}`)).status, 404);
  assert.equal(fs.existsSync(path.join(data, "videos", first.id)), false);
  successes.push(
    "Retry reprocesses the actual source; delete removes video, playback, and transcript together",
  );
  for (const success of successes) console.log(`PASS ${success}`);
} catch (error) {
  console.error(logs.slice(-6000));
  throw error;
} finally {
  await stop(worker);
  await stop(server);
  fs.rmSync(temp, { recursive: true, force: true });
}
