import { snapshot, subscribe } from "@/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (data: ReturnType<typeof snapshot>) => {
        if (!closed) controller.enqueue(encoder.encode(`id: ${data.revision}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const unsubscribe = subscribe(send);
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n")) }, 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true; clearInterval(heartbeat); unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close() } catch { /* The client may have cancelled the stream. */ }
      };
      request.signal.addEventListener("abort", cleanup);
      send(snapshot());
    },
    cancel() { cleanup() },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
