import { route } from "@/server/http";
import { retryJob } from "@/server/video-store";
import { sameOrigin } from "@/server/origin";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    sameOrigin(request);
    return { job: retryJob((await params).id) };
  });
}
