"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentHealth,
  CashierJob,
  CashierOverview,
  CashierSessionView,
  MenuProduct,
  RestaurantOrder,
} from "@/lib/cashier";
import { WorkerHealth } from "@/lib/video";

type Credentials = { id: string; token: string };
export type CashierHealth = { agent: AgentHealth; speech: WorkerHealth };
const storageKey = "relay.cashier.session.v1";
async function json<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error ||
        "Could not reach the local restaurant. Check that Relay is running.",
    );
  return value;
}
export function useCashier() {
  const [overview, setOverview] = useState<CashierOverview | null>(null);
  const [session, setSession] = useState<CashierSessionView | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [health, setHealth] = useState<CashierHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const failedSend = useRef<{
    text: string;
    messageId: string;
    source: "text" | "voice";
    utteranceId?: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    const next = await json<CashierOverview>("/api/cashier");
    setOverview(next);
    return next;
  }, []);
  const checkHealth = useCallback(async () => {
    try {
      const next = await json<CashierHealth>("/api/cashier/health");
      setHealth(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup check failed.");
      return null;
    }
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await json<CashierOverview>("/api/cashier", {
          signal: controller.signal,
        });
        if (active) setOverview(next);
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load restaurant data.",
          );
      }
      if (active) timer = setTimeout(poll, 2000);
    }
    void poll();
    void json<CashierHealth>("/api/cashier/health", {
      signal: controller.signal,
    })
      .then((next) => {
        if (active) setHealth(next);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Setup check failed.");
      });
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (
          saved &&
          /^session_[a-f0-9]{32}$/.test(saved.id) &&
          /^[A-Za-z0-9_-]{43}$/.test(saved.token)
        )
          setCredentials(saved);
      } catch {
        /* Storage is optional; backend orders remain saved. */
      }
    });
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!credentials) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await json<{ session: CashierSessionView }>(
          `/api/cashier/sessions/${credentials!.id}`,
          {
            headers: { Authorization: `Bearer ${credentials!.token}` },
            signal: controller.signal,
          },
        );
        if (active) {
          setSession(next.session);
        }
        if (active)
          timer = setTimeout(poll, next.session.processing ? 700 : 1500);
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Could not resume this ordering session. Start a new order if its data was reset.",
          );
          timer = setTimeout(poll, 3000);
        }
      }
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [credentials]);
  async function perform<T>(operation: () => Promise<T>) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action could not be completed.",
      );
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start() {
    return perform(async () => {
      const result = await json<{ session: CashierSessionView; token: string }>(
        "/api/cashier/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const next = { id: result.session.id, token: result.token };
      setCredentials(next);
      setSession(result.session);
      setHealth((previous) => ({
        agent: {
          ready: true,
          provider: result.session.provider,
          model: result.session.model,
        },
        speech: previous?.speech || { online: false },
      }));
      failedSend.current = null;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        setError(
          "This browser could not remember the session. Keep this window open; confirmed orders are still saved on the server.",
        );
      }
      void refresh().catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Reconnect to load restaurant activity.",
        ),
      );
      return result.session;
    });
  }
  async function sessionAction(
    kind: "messages" | "confirm" | "actions",
    body: unknown,
  ) {
    if (!credentials) return null;
    return perform(async () => {
      const result = await json<{ session: CashierSessionView }>(
        `/api/cashier/sessions/${credentials.id}/${kind}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.token}`,
          },
          body: JSON.stringify(body),
        },
      );
      setSession(result.session);
      void refresh().catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "The action is saved. Reconnect to load restaurant activity.",
        ),
      );
      return result.session;
    });
  }
  async function send(
    text: string,
    source: "text" | "voice" = "text",
    utteranceId?: string,
  ) {
    const previous = failedSend.current;
    const payload =
      previous?.text === text &&
      previous.source === source &&
      previous.utteranceId === utteranceId
        ? previous
        : { text, source, utteranceId, messageId: crypto.randomUUID() };
    failedSend.current = payload;
    const result = await sessionAction("messages", payload);
    if (result) failedSend.current = null;
    return !!result;
  }
  const cartAction = (
    name:
      | "remove_from_cart"
      | "update_cart_item"
      | "calculate_order_total"
      | "set_order_details",
    args: Record<string, unknown>,
  ) =>
    sessionAction("actions", {
      name,
      arguments: args,
      messageId: crypto.randomUUID(),
    });
  const confirm = () =>
    session?.quote
      ? sessionAction("confirm", {
          quoteId: session.quote.id,
          messageId: crypto.randomUUID(),
        })
      : null;
  async function saveMenu(products: MenuProduct[], revision: number) {
    return perform(async () => {
      await json("/api/cashier/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products, revision }),
      });
      return refresh();
    });
  }
  async function saveJob(job: CashierJob) {
    return perform(async () => {
      await json("/api/cashier/job", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      return refresh();
    });
  }
  async function advanceOrder(order: RestaurantOrder) {
    const stages = ["new", "preparing", "ready", "completed"] as const;
    const next = stages[stages.indexOf(order.status) + 1];
    if (!next) return null;
    return perform(async () => {
      await json(`/api/cashier/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, version: order.statusVersion }),
      });
      return refresh();
    });
  }
  return {
    overview,
    session,
    credentials,
    health,
    error,
    busy,
    clearError: () => setError(null),
    start,
    send,
    confirm,
    cartAction,
    saveMenu,
    saveJob,
    advanceOrder,
    checkHealth,
    refresh,
  };
}
export type CashierController = ReturnType<typeof useCashier>;
