import { cashierRoute, SessionParams } from "@/server/cashier-http";
import { sessionView } from "@/server/cashier-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Read-only employee inspection in this loopback-only local demonstration.
// Customer mutations still require their session capability; employee auth is not implemented.
export async function GET(_request: Request, context: SessionParams) {
  return cashierRoute(async () => ({
    session: sessionView((await context.params).id),
  }));
}
