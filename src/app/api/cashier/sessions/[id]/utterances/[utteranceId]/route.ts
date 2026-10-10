import { cashierRoute, sessionToken } from "@/server/cashier-http";
import { readUtterance } from "@/server/cashier-speech";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; utteranceId: string }> },
) {
  return cashierRoute(async () => {
    const { id, utteranceId } = await context.params;
    return { utterance: readUtterance(utteranceId, id, sessionToken(request)) };
  });
}
