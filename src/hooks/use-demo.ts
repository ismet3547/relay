"use client";
import { useCallback, useEffect, useState } from "react";
import { DemoState } from "@/lib/types";

export function useDemo() {
  const [state, setState] = useState<DemoState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const accept = useCallback((next: DemoState) => setState(previous => !previous || next.revision >= previous.revision ? next : previous), []);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/demo", { cache: "no-store" });
    if (!response.ok) throw new Error("The local backend is unavailable.");
    accept(await response.json());
  }, [accept]);
  useEffect(() => {
    let mounted = true;
    fetch("/api/demo", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("The local backend is unavailable.");
      return response.json();
    }).then(next => { if (mounted) accept(next) }).catch(err => { if (mounted) setError(err.message) });
    const stream = new EventSource("/api/events");
    stream.onopen = () => { setConnected(true); setError(null) };
    stream.onmessage = event => { try { accept(JSON.parse(event.data)); setConnected(true) } catch { setError("Could not read the live update. Please reload.") } };
    stream.onerror = () => { setConnected(false) };
    return () => { mounted = false; stream.close() };
  }, [accept]);
  const action = useCallback(async (url: string, payload: unknown, method = "POST") => {
    setPending(count => count + 1); setError(null);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This action could not be completed.");
      await refresh();
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : "Unexpected local error."); return null }
    finally { setPending(count => count - 1) }
  }, [refresh]);
  return { state, connected, error, clearError: () => setError(null), action, pending: pending > 0 };
}
