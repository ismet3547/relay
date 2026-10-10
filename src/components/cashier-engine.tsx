"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Loader2,
  Terminal,
  Utensils,
  X,
} from "lucide-react";
import { CashierController } from "@/hooks/use-cashier";
import { CashierSessionView, money } from "@/lib/cashier";

export function CashierEngine({
  cashier,
  onOpen,
}: {
  cashier: CashierController;
  onOpen: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [inspected, setInspected] = useState<CashierSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id =
    selectedId || cashier.session?.id || cashier.overview?.sessions[0]?.id;
  useEffect(() => {
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/cashier/inspect/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error || "Could not inspect this session.");
        if (active) {
          setInspected(value.session);
          setError(null);
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Inspection failed.");
      }
      if (active) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id]);
  const session =
    inspected?.id === id
      ? inspected
      : cashier.session?.id === id
        ? cashier.session
        : null;
  return (
    <div className="cashier-feature">
      <div className="cashier-engine-select">
        <label>
          Ordering session
          <select
            aria-label="Cashier session to inspect"
            value={id || ""}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setError(null);
            }}
          >
            <option value="">No session selected</option>
            {cashier.overview?.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.createdAt).toLocaleString()} · {s.agentName} ·{" "}
                {s.status}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" onClick={onOpen}>
          Open AI Cashier
          <ArrowRight size={14} />
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {session ? (
        <>
          <section className="panel cashier-engine-summary">
            <div className="panel-heading">
              <div>
                <h2>
                  {session.job.agentName} · {session.job.businessName}
                </h2>
                <p>Actual language-model requests and backend operations</p>
              </div>
              <span className="cashier-badge">
                {session.provider} · {session.model}
              </span>
            </div>
            <div className="cashier-engine-facts">
              <div>
                <span>Current action</span>
                <strong>{session.intent}</strong>
              </div>
              <div>
                <span>Cart</span>
                <strong>
                  {session.pricedCart.items.reduce((n, i) => n + i.quantity, 0)}{" "}
                  items · {money(session.pricedCart.totalMinor)}
                </strong>
              </div>
              <div>
                <span>Saved order</span>
                <strong>
                  {session.order
                    ? `${session.order.number} · ${session.order.status}`
                    : "Awaiting explicit confirmation"}
                </strong>
              </div>
            </div>
          </section>
          <div className="cashier-engine-columns">
            <section className="panel cashier-lifecycle">
              <div className="panel-heading">
                <div>
                  <h2>What actually happened</h2>
                  <p>Recorded when each operation runs</p>
                </div>
                {session.processing && <Loader2 className="spin" size={17} />}
              </div>
              <ol>
                {session.events
                  .slice()
                  .reverse()
                  .slice(0, 100)
                  .map((e) => (
                    <li
                      key={e.id}
                      className={e.stage === "error" ? "failed" : ""}
                    >
                      <span className="cashier-event-icon">
                        {e.stage === "error" ? (
                          <X size={13} />
                        ) : e.stage === "model" ? (
                          <Utensils size={13} />
                        ) : (
                          <Check size={13} />
                        )}
                      </span>
                      <div>
                        <strong>{e.label}</strong>
                        <span>
                          {e.stage}
                          <time dateTime={e.at}>
                            {new Date(e.at).toLocaleTimeString()}
                          </time>
                        </span>
                        <details>
                          <summary>
                            Event details
                            <ChevronRight size={12} />
                          </summary>
                          <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      </div>
                    </li>
                  ))}
              </ol>
            </section>
            <section className="panel cashier-tool-inspection">
              <div className="panel-heading">
                <div>
                  <h2>Technical inspection</h2>
                  <p>Real arguments, results, actors, and timestamps</p>
                </div>
                <Terminal size={18} />
              </div>
              <div className="cashier-tool-list">
                {session.tools.length ? (
                  session.tools
                    .slice()
                    .reverse()
                    .map((t) => (
                      <details
                        key={t.id}
                        className={`cashier-tool-record ${t.status}`}
                      >
                        <summary>
                          <span>
                            {t.status === "success" ? (
                              <Check size={14} />
                            ) : (
                              <X size={14} />
                            )}
                          </span>
                          <div>
                            <strong>{t.name}</strong>
                            <small>
                              {t.actor === "model"
                                ? "AI tool call"
                                : t.actor === "backend"
                                  ? "Server context read"
                                  : "Customer cart control"}{" "}
                              · {new Date(t.startedAt).toLocaleTimeString()}
                            </small>
                          </div>
                          <ChevronRight size={14} />
                        </summary>
                        <div className="cashier-tool-meta">
                          <span>
                            <Clock size={12} />
                            {t.startedAt} → {t.completedAt}
                          </span>
                          <span>
                            {t.status} · {t.id}
                          </span>
                        </div>
                        <h3>Arguments</h3>
                        <pre>{JSON.stringify(t.arguments, null, 2)}</pre>
                        <h3>Backend result</h3>
                        <pre>{JSON.stringify(t.result, null, 2)}</pre>
                      </details>
                    ))
                ) : (
                  <p className="cashier-inspection-empty">
                    Tool calls appear here after the model selects an approved
                    operation.
                  </p>
                )}
              </div>
              <div className="cashier-footnote">
                Private model reasoning is not collected or displayed. This view
                shows observable operations.
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="panel cashier-operations-empty">
          <Utensils size={32} strokeWidth={1.4} />
          <h2>
            {id ? "Loading the session…" : "Start a cashier conversation."}
          </h2>
          <p>Actual inference and tool executions will appear here.</p>
        </div>
      )}
    </div>
  );
}
