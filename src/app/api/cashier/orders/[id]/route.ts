import {
  cashierBody,
  cashierRoute,
  SessionParams,
} from "@/server/cashier-http";
import { kitchenSchema } from "@/server/cashier-schema";
import { updateKitchen } from "@/server/cashier-store";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: SessionParams) {
  return cashierRoute(async () => {
    const { id } = await context.params;
    const input = kitchenSchema.parse(await cashierBody(request));
    return { order: updateKitchen(id, input.status, input.version) };
  });
}
