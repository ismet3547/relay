import { cashierBody, cashierRoute } from "@/server/cashier-http";
import { saveMenu } from "@/server/cashier-store";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  return cashierRoute(async () => saveMenu(await cashierBody(request)));
}
