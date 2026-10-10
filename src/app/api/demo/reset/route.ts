import { z } from "zod";
import { body, route, validate } from "@/server/http";
import { resetState, snapshot } from "@/server/store";
export const runtime = "nodejs";
export function POST(request: Request) {
  return route(async () => { validate(z.object({}).strict(), await body(request)); resetState(); return snapshot() });
}
