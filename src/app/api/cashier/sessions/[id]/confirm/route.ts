import {
  cashierBody,
  cashierRoute,
  sessionToken,
  SessionParams,
} from "@/server/cashier-http";
import { confirmationSchema } from "@/server/cashier-schema";
import { confirmFromCustomer } from "@/server/cashier-ai";
export const runtime = "nodejs";
export async function POST(request: Request, context: SessionParams) {
  return cashierRoute(async () => {
    const { id } = await context.params;
    const input = confirmationSchema.parse(await cashierBody(request));
    return confirmFromCustomer(
      id,
      sessionToken(request),
      input.quoteId,
      input.messageId,
    );
  });
}
