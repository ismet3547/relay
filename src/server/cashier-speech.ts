import fs from "node:fs";
import path from "node:path";
import { Utterance } from "../lib/cashier";
import {
  authorizeSession,
  cashEvent,
  cashierId,
  cashierMutate,
  cashierNow,
  findSession,
} from "./cashier-store";
import { DemoError } from "./errors";
import { sameOrigin } from "./origin";
import { videoRoot, videoState } from "./video-store";

const maxAudioBytes = 4 * 1048576;
function utteranceRoot() {
  const dir = path.join(videoRoot(), "utterances");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function directory(id: string) {
  if (!/^utt_[a-f0-9]{32}$/.test(id))
    throw new DemoError(
      "UTTERANCE_NOT_FOUND",
      "Recognized speech not found.",
      404,
    );
  return path.join(utteranceRoot(), id);
}
export function validateAudioHeader(header: Buffer, mime: string) {
  const webm = header
    .subarray(0, 4)
    .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const ogg = header.toString("ascii", 0, 4) === "OggS";
  const wav =
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WAVE";
  const mp4 = header.toString("ascii", 4, 8) === "ftyp";
  if (
    !(
      (mime === "audio/webm" && webm) ||
      (mime === "audio/ogg" && ogg) ||
      (["audio/wav", "audio/x-wav"].includes(mime) && wav) ||
      (mime === "audio/mp4" && mp4)
    )
  )
    throw new DemoError(
      "INVALID_AUDIO",
      "Record a new WebM, Ogg, MP4, or WAV audio utterance.",
      415,
    );
}
export async function uploadUtterance(
  request: Request,
  sessionId: string,
  token: string,
) {
  sameOrigin(request, "Cross-origin microphone uploads are not allowed.");
  const session = authorizeSession(sessionId, token);
  if (session.processing)
    throw new DemoError(
      "AGENT_BUSY",
      "Wait for the current reply before speaking.",
      409,
    );
  if (session.status === "handoff")
    throw new DemoError(
      "SESSION_CLOSED",
      "Start a new session after requesting staff help.",
      409,
    );
  const worker = videoState().worker;
  if (!worker.online || worker.status !== "ready")
    throw new DemoError(
      "SPEECH_SETUP_REQUIRED",
      worker.error ||
        "Start Relay with npm run dev:all and check the Whisper/FFmpeg setup.",
      503,
    );
  const mime = (request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    ![
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",
    ].includes(mime) ||
    !request.body
  )
    throw new DemoError(
      "INVALID_AUDIO_TYPE",
      "Upload a microphone audio recording.",
      415,
    );
  if (Number(request.headers.get("content-length")) > maxAudioBytes)
    throw new DemoError(
      "AUDIO_TOO_LARGE",
      "Microphone recordings are limited to 4 MB and 30 seconds.",
      413,
    );
  const root = utteranceRoot();
  let count = 0;
  let pending = 0;
  for (const name of fs
    .readdirSync(root)
    .filter((n) => /^utt_[a-f0-9]{32}$/.test(n))) {
    count++;
    try {
      const job = JSON.parse(
        fs.readFileSync(path.join(root, name, "job.json"), "utf8"),
      );
      if (["uploading", "queued", "processing"].includes(job.status)) {
        pending++;
        if (job.sessionId === sessionId)
          throw new DemoError(
            "SPEECH_BUSY",
            "Wait for your previous recording to be recognized.",
            409,
          );
      }
    } catch (error) {
      if (error instanceof DemoError) throw error;
    }
  }
  if (count >= 200)
    throw new DemoError(
      "SPEECH_QUEUE_FULL",
      "The speech queue is full. Keep the worker running to clean expired utterances.",
      409,
    );
  if (pending >= 10)
    throw new DemoError(
      "SPEECH_QUEUE_FULL",
      "Ten utterances are already waiting. Let the local worker catch up before recording again.",
      409,
    );
  const id = cashierId("utt");
  const dir = directory(id);
  fs.mkdirSync(dir, { mode: 0o700 });
  const temp = path.join(dir, "upload.part");
  const reader = request.body.getReader();
  let bytes = 0;
  let handle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
  try {
    const at = cashierNow();
    // Reserve the session before awaiting stream I/O, including in-flight audio.
    fs.writeFileSync(
      path.join(dir, "job.json"),
      JSON.stringify({
        id,
        sessionId,
        status: "uploading",
        createdAt: at,
        updatedAt: at,
      }),
      { mode: 0o600 },
    );
    handle = await fs.promises.open(temp, "wx", 0o600);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxAudioBytes) {
        await reader.cancel();
        throw new DemoError(
          "AUDIO_TOO_LARGE",
          "Microphone recordings are limited to 4 MB and 30 seconds.",
          413,
        );
      }
      let offset = 0;
      while (offset < value.length) {
        const written = await handle.write(
          value,
          offset,
          value.length - offset,
        );
        if (!written.bytesWritten) throw new Error("Audio write failed");
        offset += written.bytesWritten;
      }
    }
    await handle.close();
    if (!bytes)
      throw new DemoError(
        "EMPTY_AUDIO",
        "Record an utterance before sending it.",
      );
    const header = Buffer.alloc(32);
    const fd = fs.openSync(temp, "r");
    try {
      fs.readSync(fd, header, 0, 32, 0);
    } finally {
      fs.closeSync(fd);
    }
    validateAudioHeader(header, mime);
    fs.renameSync(temp, path.join(dir, "source.audio"));
    const job = {
      id,
      sessionId,
      status: "queued" as const,
      requestedLanguage: "auto",
      createdAt: at,
      updatedAt: cashierNow(),
      bytes,
      mimeType: mime,
    };
    const file = path.join(dir, "job.part.json");
    fs.writeFileSync(file, JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(file, path.join(dir, "job.json"));
    cashierMutate((state) =>
      cashEvent(
        findSession(state, sessionId),
        "voice",
        "Microphone utterance queued for real local recognition",
        { utteranceId: id, bytes, status: "queued" },
      ),
    );
    return job as Utterance;
  } catch (error) {
    await handle?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export function readUtterance(
  id: string,
  sessionId: string,
  token: string,
): Utterance {
  const session = authorizeSession(sessionId, token);
  const file = path.join(directory(id), "job.json");
  if (!fs.existsSync(file))
    throw new DemoError(
      "UTTERANCE_NOT_FOUND",
      "Speech recognition expired or was not found. Record again.",
      404,
    );
  const job = JSON.parse(fs.readFileSync(file, "utf8"));
  if (job.sessionId !== sessionId)
    throw new DemoError(
      "UTTERANCE_UNAUTHORIZED",
      "This utterance belongs to another ordering session.",
      403,
    );
  if (
    !session.events.some(
      (e) =>
        e.stage === "voice" &&
        (e.metadata as { utteranceId?: string; status?: string })
          .utteranceId === id &&
        (e.metadata as { status?: string }).status === job.status,
    )
  ) {
    cashierMutate((state) =>
      cashEvent(
        findSession(state, sessionId),
        "voice",
        job.status === "completed"
          ? "Actual Whisper transcript ready"
          : job.status === "failed"
            ? "Speech recognition failed"
            : "Local speech recognition processing",
        {
          utteranceId: id,
          status: job.status,
          model: job.model,
          duration: job.duration,
          language: job.language,
          error: job.error,
        },
      ),
    );
  }
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    text: job.text,
    language: job.language,
    duration: job.duration,
    model: job.model,
    error: job.error,
  };
}
