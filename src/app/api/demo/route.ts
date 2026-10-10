import { z } from "zod";
import { body, route, validate } from "@/server/http";
import { mutate, snapshot } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return route(() => snapshot()) }
export function PATCH(request: Request) {
  return route(async () => {
    const { agentActive } = validate(z.object({ agentActive: z.boolean() }).strict(), await body(request));
    mutate(state => { state.agentActive = agentActive });
    return snapshot();
  });
}
