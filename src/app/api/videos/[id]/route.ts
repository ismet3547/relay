import { route } from "@/server/http";
import { deleteJob, readJob } from "@/server/video-store";
import { sameOrigin } from "@/server/video-http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return route(async () => ({ job: readJob((await params).id) }));
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    sameOrigin(request);
    return deleteJob((await params).id);
  });
}
