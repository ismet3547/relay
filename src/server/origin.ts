import { DemoError } from "./errors";

export function sameOrigin(
  request: Request,
  message = "Cross-origin changes are not allowed.",
) {
  const origin = request.headers.get("origin");
  if (origin === null) return;

  let expectedOrigin: string | undefined;
  try {
    const url = new URL(request.url);
    // Next.js normalizes loopback URLs to localhost. Host retains the authority
    // the browser actually requested, including its port.
    const host = request.headers.get("host") ?? url.host;
    if (
      ["http:", "https:"].includes(url.protocol) &&
      host &&
      !/[\s,\\/?#@]/.test(host)
    )
      expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
  } catch {
    // Invalid authorities fail the same origin check below.
  }
  if (origin !== expectedOrigin)
    throw new DemoError("ORIGIN_REJECTED", message, 403);
}
