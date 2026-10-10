import { z } from "zod";
import { cashierBody, cashierRoute } from "@/server/cashier-http";
import { cashierProvider } from "@/server/cashier-ai";
import { createSession } from "@/server/cashier-store";
import { DemoError } from "@/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return cashierRoute(async () => {
    z.strictObject({}).parse(await cashierBody(request));
    const provider = cashierProvider();
    const health = await provider.health();
    if (!health.ready)
      throw new DemoError(
        "AI_SETUP_REQUIRED",
        health.error || "Set up Ollama before starting an AI session.",
        503,
      );
    return createSession(provider.provider, provider.model);
  }, 201);
}
