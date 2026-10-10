import {
  cashierBody,
  cashierRoute,
  sessionToken,
  SessionParams,
} from "@/server/cashier-http";
import { customerAction, customerActionSchema } from "@/server/cashier-actions";
export const runtime = "nodejs";
export async function POST(request: Request, context: SessionParams) {
  return cashierRoute(async () => {
    const { id } = await context.params;
    return customerAction(
      id,
      sessionToken(request),
      customerActionSchema.parse(await cashierBody(request)),
    );
  });
}
