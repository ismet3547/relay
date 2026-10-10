import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DemoError } from "./errors";
import { jobDirectory, readJob } from "./video-store";

export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]))
    throw new DemoError("INVALID_RANGE", "Invalid media range.", 416);
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size
  )
    throw new DemoError("INVALID_RANGE", "Invalid media range.", 416);
  return { start, end };
}
export function mediaResponse(request: Request, id: string, head = false) {
  const job = readJob(id);
  if (!job.playbackReady || job.status === "deleting")
    throw new DemoError(
      "MEDIA_NOT_READY",
      "Playback is still being prepared.",
      409,
    );
  const file = path.join(jobDirectory(id), "playback.mp4");
  if (!fs.existsSync(file))
    throw new DemoError(
      "MEDIA_NOT_FOUND",
      "The playback file is unavailable. Retry or upload the video again.",
      404,
    );
  const size = fs.statSync(file).size;
  let range;
  try {
    range = byteRange(request.headers.get("range"), size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(
    head
      ? null
      : (Readable.toWeb(
          fs.createReadStream(file, { start, end }),
        ) as ReadableStream<Uint8Array>),
    { status: range ? 206 : 200, headers },
  );
}
