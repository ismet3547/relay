import { cashierBody, cashierRoute } from "@/server/cashier-http";
import { saveJob } from "@/server/cashier-store";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  return cashierRoute(async () => ({
    job: saveJob(await cashierBody(request)),
  }));
}
