import { cashierRoute } from "@/server/cashier-http";
import { cashierOverview } from "@/server/cashier-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return cashierRoute(cashierOverview);
}
