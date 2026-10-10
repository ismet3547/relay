import { cashierRoute } from "@/server/cashier-http";
import { cashierProvider } from "@/server/cashier-ai";
import { videoState } from "@/server/video-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return cashierRoute(async () => ({
    agent: await cashierProvider().health(),
    speech: videoState().worker,
  }));
}
