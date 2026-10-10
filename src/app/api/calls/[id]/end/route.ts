import { z } from "zod";
import { body, route, validate } from "@/server/http";
import { endCall } from "@/server/orchestrator";
export const runtime = "nodejs";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => { validate(z.object({}).strict(), await body(request)); const { id } = await context.params; return { call: await endCall(id) } });
}
