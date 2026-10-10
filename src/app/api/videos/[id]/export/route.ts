import { DemoError } from "@/server/errors";
import { readJob } from "@/server/video-store";
import { exportTranscript } from "@/lib/video";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const job = readJob((await params).id);
    const format = new URL(request.url).searchParams.get("format") ?? "txt";
    if (!["txt", "srt", "vtt"].includes(format))
      throw new DemoError("INVALID_FORMAT", "Choose TXT, SRT, or VTT.");
    if (job.status !== "completed")
      throw new DemoError(
        "TRANSCRIPT_NOT_READY",
        "Wait for transcription to finish before downloading.",
        409,
      );
    const filename = `${job.filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "transcript"}.${format}`;
    return new Response(
      exportTranscript(job.segments, format as "txt" | "srt" | "vtt"),
      {
        headers: {
          "Content-Type": `${format === "vtt" ? "text/vtt" : "text/plain"}; charset=utf-8`,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    const known = error instanceof DemoError;
    return Response.json(
      { error: known ? error.message : "Could not download the transcript." },
      { status: known ? error.status : 500 },
    );
  }
}
