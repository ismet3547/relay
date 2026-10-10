import { z } from "zod";
import { DemoError } from "./errors";
import { sameOrigin } from "./origin";

export async function cashierBody(request: Request): Promise<unknown> {
  sameOrigin(request, "Cross-origin restaurant writes are not allowed.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new DemoError(
      "INVALID_CONTENT_TYPE",
      "Send an application/json request.",
      415,
    );
  const reader = request.body?.getReader();
  if (!reader) throw new DemoError("INVALID_JSON", "Send a JSON request body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) {
        await reader.cancel();
        throw new DemoError(
          "INPUT_TOO_LARGE",
          "Restaurant requests are limited to 64 KB.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DemoError("INVALID_JSON", "Send a valid JSON request.");
  }
}
export function sessionToken(request: Request) {
  return (
    request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || ""
  );
}
export async function cashierRoute(
  fn: () => unknown | Promise<unknown>,
  status = 200,
) {
  try {
    return Response.json(await fn(), {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const known = error instanceof DemoError;
    const validation = error instanceof z.ZodError;
    if (!known && !validation)
      console.error(
        "Restaurant route failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
    return Response.json(
      {
        error: known
          ? error.message
          : validation
            ? error.issues
                .map((i) => `${i.path.join(".") || "Request"}: ${i.message}`)
                .join(" ")
            : "The restaurant could not complete this action. Your saved orders are preserved.",
        code: known
          ? error.code
          : validation
            ? "VALIDATION_ERROR"
            : "INTERNAL_ERROR",
      },
      {
        status: known ? error.status : validation ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export type SessionParams = { params: Promise<{ id: string }> };
