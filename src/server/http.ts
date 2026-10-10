import { z } from "zod";
import { DemoError } from "./errors";
import { sameOrigin } from "./origin";

export async function body(request: Request): Promise<unknown> {
  sameOrigin(request, "Cross-origin demo writes are not allowed.");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new DemoError("INVALID_CONTENT_TYPE", "Send an application/json request.", 415);
  const text = await request.text();
  if (text.length > 4096) throw new DemoError("INPUT_TOO_LARGE", "Demo request is too large.", 413);
  try { return JSON.parse(text) } catch { throw new DemoError("INVALID_JSON", "Send a valid JSON request.") }
}
export async function route(fn: () => unknown | Promise<unknown>) {
  try { return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } }) }
  catch (error) {
    const known = error instanceof DemoError;
    if (!known) console.error("Local demo route failed", error);
    return Response.json({ error: known ? error.message : "The local demo could not finish this action. Please retry or reset.", code: known ? error.code : "INTERNAL_ERROR" }, { status: known ? error.status : 500 });
  }
}
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DemoError("VALIDATION_ERROR", parsed.error.issues.map(i => i.message).join(" "));
  return parsed.data;
}
