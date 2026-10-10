import { DemoError } from "@/server/errors";
import { mediaResponse } from "@/server/video-http";
export const runtime = "nodejs";
async function response(
  request: Request,
  params: Promise<{ id: string }>,
  head = false,
) {
  try {
    return mediaResponse(request, (await params).id, head);
  } catch (error) {
    const known = error instanceof DemoError;
    return Response.json(
      { error: known ? error.message : "Playback is unavailable." },
      { status: known ? error.status : 500 },
    );
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return response(request, params);
}
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return response(request, params, true);
}
