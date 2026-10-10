import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { VideoJob } from "../lib/video";
import { DemoError } from "./errors";
import { jobDirectory, videoConfig, videoRoot, writeJob } from "./video-store";

export function validateVideoHeader(
  header: Buffer,
  extension: string,
  mime: string,
) {
  if (!videoConfig.extensions.includes(extension))
    throw new DemoError(
      "UNSUPPORTED_FORMAT",
      "Choose an MP4, MOV, or WebM video.",
      415,
    );
  if (!videoConfig.mimeTypes.includes(mime))
    throw new DemoError(
      "INVALID_MEDIA_TYPE",
      "The uploaded file is not a supported video.",
      415,
    );
  const iso = header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp";
  const webm =
    header.length >= 4 &&
    header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (
    (extension === "webm" &&
      (!webm || !["video/webm", "application/octet-stream"].includes(mime))) ||
    (extension !== "webm" && (!iso || mime === "video/webm"))
  )
    throw new DemoError(
      "INVALID_VIDEO_SIGNATURE",
      "The file contents do not match its video format. Export a new MP4, MOV, or WebM file.",
      415,
    );
}
export async function uploadVideo(request: Request): Promise<VideoJob> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new DemoError(
      "ORIGIN_REJECTED",
      "Cross-origin uploads are not allowed.",
      403,
    );
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;") || !request.body)
    throw new DemoError(
      "INVALID_UPLOAD",
      "Upload a video using the file selector.",
    );
  const length = Number(request.headers.get("content-length"));
  if (length > videoConfig.maxUploadBytes + 16384)
    throw new DemoError(
      "FILE_TOO_LARGE",
      `Videos must be under ${videoConfig.maxUploadBytes / 1048576} MB.`,
      413,
    );
  // Count in-flight uploads as well as committed jobs before reserving a directory.
  if (
    fs
      .readdirSync(path.join(videoRoot(), "videos"))
      .filter((name) => /^vid_[a-f0-9]{32}$/.test(name)).length >=
    videoConfig.maxRecordings
  )
    throw new DemoError(
      "STORAGE_LIMIT",
      `Delete an existing recording before uploading more than ${videoConfig.maxRecordings} videos.`,
      409,
    );
  const id = `vid_${randomUUID().replaceAll("-", "")}`;
  const dir = jobDirectory(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, "upload.part");
  let filename = "";
  let extension = "";
  let mime = "";
  let bytes = 0;
  let language: VideoJob["requestedLanguage"] = "auto";
  let fileCount = 0;
  let failure: Error | null = null;
  let transfer: Promise<void> | null = null;
  try {
    // Busboy emits partsLimit when it reaches the limit, including the closing boundary.
    const parser = Busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 1,
        fields: 1,
        parts: 3,
        fileSize: videoConfig.maxUploadBytes,
        fieldSize: 16,
        headerPairs: 100,
      },
    });
    let received = 0;
    const bounded = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        done(
          received > videoConfig.maxUploadBytes + 16384
            ? new DemoError(
                "FILE_TOO_LARGE",
                "The upload exceeds the video size limit.",
                413,
              )
            : null,
          chunk,
        );
      },
    });
    parser.on("field", (name, value) => {
      if (name !== "language" || !["auto", "en", "tr"].includes(value))
        failure = new DemoError(
          "INVALID_LANGUAGE",
          "Select auto-detect, English, or Turkish.",
        );
      else language = value as VideoJob["requestedLanguage"];
    });
    parser.on("filesLimit", () => {
      failure = new DemoError("TOO_MANY_FILES", "Upload one video at a time.");
    });
    parser.on("fieldsLimit", () => {
      failure = new DemoError("INVALID_UPLOAD", "Too many upload fields.");
    });
    parser.on("partsLimit", () => {
      failure = new DemoError("INVALID_UPLOAD", "Too many upload parts.");
    });
    parser.on("file", (name, stream, info) => {
      fileCount++;
      filename = path
        .basename((info.filename ?? "").replaceAll("\\", "/"))
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, 180);
      extension = path.extname(filename).slice(1).toLowerCase();
      mime = info.mimeType;
      if (
        name !== "video" ||
        !videoConfig.extensions.includes(extension) ||
        !videoConfig.mimeTypes.includes(mime)
      ) {
        failure = new DemoError(
          "UNSUPPORTED_FORMAT",
          "Choose an MP4, MOV, or WebM video.",
          415,
        );
        stream.resume();
        return;
      }
      stream.on("limit", () => {
        failure = new DemoError(
          "FILE_TOO_LARGE",
          `Videos must be under ${videoConfig.maxUploadBytes / 1048576} MB.`,
          413,
        );
      });
      stream.on("data", (chunk) => {
        bytes += chunk.length;
      });
      parser.on("error", (error) =>
        stream.destroy(
          error instanceof Error ? error : new Error("Upload stream failed"),
        ),
      );
      transfer = pipeline(
        stream,
        fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }),
      );
      // The parser may fail first; keep the file promise observed until the outer cleanup awaits it.
      transfer.catch((error) => {
        failure = error;
      });
    });
    await pipeline(
      Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream,
      ),
      bounded,
      parser,
    );
    if (transfer) await transfer;
    if (failure) throw failure;
    if (fileCount !== 1 || bytes === 0)
      throw new DemoError("EMPTY_VIDEO", "Choose a video that contains data.");
    const handle = fs.openSync(temp, "r");
    const header = Buffer.alloc(32);
    fs.readSync(handle, header, 0, 32, 0);
    fs.closeSync(handle);
    validateVideoHeader(header, extension, mime);
    fs.renameSync(temp, path.join(dir, "source.video"));
    const at = new Date().toISOString();
    const job: VideoJob = {
      id,
      filename,
      extension,
      mimeType: mime,
      bytes,
      requestedLanguage: language,
      status: "queued",
      stage: "validation",
      createdAt: at,
      updatedAt: at,
      playbackReady: false,
      segments: [],
      attempt: 1,
      events: [
        {
          id: randomUUID(),
          at,
          stage: "upload",
          kind: "completed",
          label: "Video uploaded to local storage",
          metadata: { filename, bytes, mimeType: mime },
        },
      ],
    };
    writeJob(job);
    return job;
  } catch (error) {
    if (transfer) await Promise.resolve(transfer).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    if (error instanceof DemoError) throw error;
    throw new DemoError(
      "UPLOAD_INTERRUPTED",
      "The upload was interrupted. Choose the video and try again.",
    );
  }
}
