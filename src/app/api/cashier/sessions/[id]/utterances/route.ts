import {
  cashierRoute,
  sessionToken,
  SessionParams,
} from "@/server/cashier-http";
import { uploadUtterance } from "@/server/cashier-speech";
export const runtime = "nodejs";
export async function POST(request: Request, context: SessionParams) {
  return cashierRoute(
    async () => ({
      utterance: await uploadUtterance(
        request,
        (await context.params).id,
        sessionToken(request),
      ),
    }),
    202,
  );
}
