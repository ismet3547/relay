import { route } from "@/server/http";
import { videoState } from "@/server/video-store";
import { uploadVideo } from "@/server/video-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return route(() => videoState());
}
export async function POST(request: Request) {
  return route(async () => ({ job: await uploadVideo(request) }));
}
