import { body, route, validate } from "@/server/http";
import { scenarioSchema, startCall } from "@/server/orchestrator";
export const runtime = "nodejs";
export function POST(request: Request) {
  return route(async () => { const { scenario } = validate(scenarioSchema, await body(request)); return { call: await startCall(scenario) } });
}
