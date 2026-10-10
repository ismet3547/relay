import {
  cashierRoute,
  sessionToken,
  SessionParams,
} from "@/server/cashier-http";
import { authorizeSession, sessionView } from "@/server/cashier-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: SessionParams) {
  return cashierRoute(async () => {
    const { id } = await context.params;
    authorizeSession(id, sessionToken(request));
    return { session: sessionView(id) };
  });
}
