import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  activeSegmentIndex,
  exportTranscript,
  searchSegments,
  timestamp,
  type VideoJob,
} from "../src/lib/video";
import { byteRange } from "../src/server/video-http";
import {
  deleteJob,
  readJob,
  retryJob,
  videoState,
  writeJob,
  videoConfig,
} from "../src/server/video-store";
import { uploadVideo, validateVideoHeader } from "../src/server/video-upload";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-video-unit-"));
process.env.RELAY_DATA_DIR = directory;
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const segments = [
  { id: 0, start: 3.12, end: 5.67, text: "Hello from Relay." },
  { id: 1, start: 7, end: 11.01, text: "Merhaba dünya." },
];
const header = Buffer.from("000000206674797069736f6d00000200", "hex");

test("timestamps preserve milliseconds and carry across minute/hour boundaries", () => {
  assert.equal(timestamp(3.12), "00:03");
  assert.equal(timestamp(59.9996, true), "00:01:00.000");
  assert.equal(timestamp(3601.025, true), "01:00:01.025");
  assert.equal(timestamp(-1), "00:00");
});
test("playback highlight respects actual segment boundaries, gaps, and seeking", () => {
  assert.equal(activeSegmentIndex(segments, 3), -1);
  assert.equal(activeSegmentIndex(segments, 3.12), 0);
  assert.equal(activeSegmentIndex(segments, 5.67), -1);
  assert.equal(activeSegmentIndex(segments, 8), 1);
  assert.equal(activeSegmentIndex(segments, 11.01), -1);
  assert.equal(activeSegmentIndex(segments, 4), 0);
});
test("transcript search returns actual matching segments without interpreting HTML", () => {
  assert.deepEqual(searchSegments(segments, "  RELAY  "), [segments[0]]);
  assert.deepEqual(searchSegments(segments, "dünya"), [segments[1]]);
  assert.deepEqual(searchSegments(segments, "missing"), []);
  assert.deepEqual(searchSegments(segments, ""), []);
});
test("TXT, SRT, and VTT export use original timestamps and Unicode text", () => {
  assert.equal(
    exportTranscript(segments, "txt"),
    "[00:03] Hello from Relay.\n[00:07] Merhaba dünya.\n",
  );
  assert.equal(
    exportTranscript(segments, "srt"),
    "1\n00:00:03,120 --> 00:00:05,670\nHello from Relay.\n\n2\n00:00:07,000 --> 00:00:11,010\nMerhaba dünya.\n",
  );
  assert.match(
    exportTranscript(segments, "vtt"),
    /^WEBVTT\n\n1\n00:00:03\.120 --> 00:00:05\.670/,
  );
  assert.match(
    exportTranscript([{ ...segments[0], text: "a\n\n --> b" }], "srt"),
    /a → b/,
  );
});
test("file extensions, MIME types, and signatures must agree", () => {
  validateVideoHeader(header, "mp4", "video/mp4");
  validateVideoHeader(header, "mov", "video/quicktime");
  validateVideoHeader(
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    "webm",
    "video/webm",
  );
  for (const [bytes, ext, mime] of [
    [header, "exe", "video/mp4"],
    [header, "webm", "video/webm"],
    [Buffer.from("fake video"), "mp4", "video/mp4"],
    [header, "mp4", "text/plain"],
  ] as const)
    assert.throws(() => validateVideoHeader(bytes, ext, mime));
});
test("streaming upload rejects malformed multipart, fake media, and invalid languages; cleans partial files", async () => {
  const upload = async (filename: string, language: string, data: Buffer) => {
    const form = new FormData();
    form.set("language", language);
    form.set(
      "video",
      new Blob([new Uint8Array(data)], { type: "video/mp4" }),
      filename,
    );
    return uploadVideo(
      new Request("http://localhost/api/videos", {
        method: "POST",
        body: form,
      }),
    );
  };
  await assert.rejects(
    upload("wrong.mp4", "auto", Buffer.from("not a video")),
    /contents do not match/,
  );
  await assert.rejects(
    upload("valid.mp4", "invalid", header),
    /Select auto-detect/,
  );
  await assert.rejects(
    uploadVideo(
      new Request("http://localhost/api/videos", {
        method: "POST",
        body: "garbage",
        headers: { "content-type": "multipart/form-data; boundary=broken" },
      }),
    ),
    /interrupted/,
  );
  assert.equal(videoState().jobs.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(directory, "videos")), []);
});
test("a valid upload is queued durably with only the upload event; filename paths are stripped", async () => {
  const form = new FormData();
  form.set("language", "tr");
  form.set(
    "video",
    new Blob([header], { type: "video/mp4" }),
    "C:\\Users\\Private\\recording.mp4",
  );
  const job = await uploadVideo(
    new Request("http://localhost/api/videos", { method: "POST", body: form }),
  );
  assert.equal(job.filename, "recording.mp4");
  assert.equal(job.status, "queued");
  assert.equal(job.requestedLanguage, "tr");
  assert.equal(job.events.length, 1);
  assert.equal(job.events[0].stage, "upload");
  assert.equal(job.segments.length, 0);
  assert.deepEqual(readJob(job.id), job);
  assert.equal(videoState().jobs.length, 1);
  deleteJob(job.id);
  assert.equal(videoState().jobs.length, 0);
});

test("upload size, multiple files, cross-origin requests, and interrupted file streams are rejected and cleaned", async () => {
  const request = (form: FormData, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/videos", {
      method: "POST",
      body: form,
      headers,
    });
  const form = new FormData();
  form.set("video", new Blob([header], { type: "video/mp4" }), "one.mp4");
  await assert.rejects(
    uploadVideo(request(form, { origin: "https://elsewhere.test" })),
    /Cross-origin/,
  );
  await assert.rejects(
    uploadVideo(request(form, { "content-length": "200000000" })),
    /under 100 MB/,
  );
  const two = new FormData();
  two.set("language", "auto");
  two.append("video", new Blob([header], { type: "video/mp4" }), "one.mp4");
  two.append("video", new Blob([header], { type: "video/mp4" }), "two.mp4");
  await assert.rejects(
    uploadVideo(request(two)),
    /one video|Too many upload parts/,
  );
  const originalLimit = videoConfig.maxUploadBytes;
  try {
    videoConfig.maxUploadBytes = 8;
    await assert.rejects(uploadVideo(request(form)), /under|size limit/);
  } finally {
    videoConfig.maxUploadBytes = originalLimit;
  }
  const truncated =
    '--broken\r\nContent-Disposition: form-data; name="video"; filename="partial.mp4"\r\nContent-Type: video/mp4\r\n\r\npartial data';
  await assert.rejects(
    uploadVideo(
      new Request("http://localhost/api/videos", {
        method: "POST",
        body: truncated,
        headers: { "content-type": "multipart/form-data; boundary=broken" },
      }),
    ),
    /interrupted/,
  );
  assert.equal(videoState().jobs.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(directory, "videos")), []);
});
test("media ranges support direct seeks and suffix requests, reject invalid ranges", () => {
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=50-", 100), { start: 50, end: 99 });
  assert.deepEqual(byteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(byteRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const range of [
    "bytes=100-",
    "bytes=20-10",
    "bytes=-0",
    "bytes=0-1,2-3",
    "bytes=",
    "anything",
  ])
    assert.throws(() => byteRange(range, 100));
});
test("failed jobs retry as queued; running jobs cannot retry; deletion waits for the worker claim", () => {
  const at = new Date().toISOString();
  const id = "vid_" + "a".repeat(32);
  const job: VideoJob = {
    id,
    filename: "recording.mp4",
    bytes: 32,
    mimeType: "video/mp4",
    extension: "mp4",
    status: "failed",
    stage: "validation",
    createdAt: at,
    updatedAt: at,
    requestedLanguage: "auto",
    playbackReady: false,
    segments: [],
    events: [],
    attempt: 1,
    error: { code: "NO_AUDIO", message: "No audio" },
  };
  writeJob(job);
  const queued = retryJob(id);
  assert.equal(queued.status, "queued");
  assert.equal(queued.error, undefined);
  assert.equal(queued.attempt, 2);
  assert.equal(queued.events[0].kind, "recovered");
  assert.throws(() => retryJob(id), /Only a finished failed/);
  writeJob({ ...queued, status: "processing" });
  assert.deepEqual(deleteJob(id), { deleting: true });
  assert.equal(readJob(id).status, "deleting");
  assert.throws(() => readJob("../../private"), /Recording not found/);
});
