import { body, route } from "@/server/http";
import { submitInput } from "@/server/orchestrator";
export const runtime = "nodejs";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => { const { id } = await context.params; return { call: await submitInput(id, await body(request)) } });
}
