"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Blocks,
  Check,
  ChefHat,
  ChevronDown,
  Loader2,
  MessageSquare,
  Mic,
  Minus,
  Plus,
  Send,
  ShoppingBag,
  Square,
  Utensils,
  Volume2,
  X,
} from "lucide-react";
import { CashierController } from "@/hooks/use-cashier";
import { useCashierVoice } from "@/hooks/use-cashier-voice";
import { categories, money } from "@/lib/cashier";

export function CashierWorkspace({
  cashier,
  onEngine,
  onKitchen,
}: {
  cashier: CashierController;
  onEngine: () => void;
  onKitchen: () => void;
}) {
  const { session, overview, health, busy } = cashier;
  const [text, setText] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [category, setCategory] = useState<string>("All");
  const [productId, setProductId] = useState<string | null>(null);
  const product = overview?.products.find((p) => p.id === productId) || null;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const voice = useCashierVoice(cashier);
  const locked =
    busy ||
    !!session?.processing ||
    ["listening", "permission", "transcribing"].includes(voice.phase);
  const closed =
    session?.status === "confirmed" || session?.status === "handoff";
  const cart = session?.pricedCart;
  const quoteValid =
    !!session?.quoteValid &&
    session.quote?.menuRevision === overview?.menuRevision;
  const lastMessageId = session?.messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lastMessageId, session?.processing]);
  async function submit() {
    const value = text.trim();
    if (!value || locked) return;
    if (await cashier.send(value)) {
      setText("");
      input.current?.focus();
    }
  }
  const phaseLabel =
    voice.phase === "listening"
      ? "Listening · press stop when finished"
      : voice.phase === "permission"
        ? "Waiting for microphone permission"
        : voice.phase === "transcribing"
          ? "Recognizing your speech locally…"
          : session?.processing
            ? "Processing your request with the model…"
            : voice.phase === "speaking"
              ? "Speaking the reply"
              : session?.status === "handoff"
                ? "Staff help requested"
                : session?.order
                  ? `Kitchen · ${session.order.status}`
                  : session
                    ? "Ready for your order"
                    : "A real conversation. A saved order.";
  return (
    <div className="cashier-feature">
      <div className="cashier-toolbar">
        <span>
          <Utensils size={16} />
          <strong>
            {session?.job.businessName ||
              overview?.job.businessName ||
              "Relay Burger"}
          </strong>
          <span className="cashier-badge">Fast-Food Cashier</span>
        </span>
        <div>
          <button
            className="button secondary"
            onClick={() => setShowMenu(!showMenu)}
            aria-expanded={showMenu}
          >
            <ShoppingBag size={15} />
            {showMenu ? "Hide menu" : "Browse menu"}
            <ChevronDown size={13} />
          </button>
          <button className="text-button" onClick={onEngine}>
            <Blocks size={15} />
            AI Engine
          </button>
        </div>
      </div>
      {showMenu && (
        <section
          className="panel cashier-menu-browser"
          aria-label="Restaurant menu"
        >
          <div className="cashier-categories">
            {["All", ...categories].map((c) => (
              <button
                key={c}
                className={category === c ? "selected" : ""}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="cashier-product-grid">
            {overview?.products
              .filter((p) => category === "All" || p.category === category)
              .map((p) => (
                <button
                  className="cashier-product"
                  key={p.id}
                  onClick={() => setProductId(p.id)}
                >
                  <span className="eyebrow">{p.category}</span>
                  <strong>{p.name}</strong>
                  <p>{p.description}</p>
                  <span>
                    {money(p.priceMinor)}
                    <small>{p.options.length ? " + selections" : ""}</small>
                    {!p.available && <em>Sold out</em>}
                  </span>
                </button>
              ))}
          </div>
          <p className="cashier-footnote">
            Prices before selections and tax. Menu defaults and extras appear in
            the live cart.
          </p>
        </section>
      )}
      {product && (
        <section
          className="panel cashier-product-detail"
          aria-label={`${product.name} details`}
        >
          <div className="panel-heading">
            <div>
              <h2>
                {product.name} · {money(product.priceMinor)} base
              </h2>
              <p>
                {product.available ? "Available" : "Sold out"} ·{" "}
                {product.category}
              </p>
            </div>
            <button
              className="icon-button"
              onClick={() => setProductId(null)}
              aria-label="Close product details"
            >
              <X size={17} />
            </button>
          </div>
          <div className="cashier-detail-body">
            <p>{product.description}</p>
            {product.options.map((g) => (
              <p key={g.id}>
                <strong>{g.name}</strong> ·{" "}
                {g.required ? "Required" : "Optional"}
                {g.defaultChoiceId
                  ? ` · default: ${g.choices.find((c) => c.id === g.defaultChoiceId)?.name}`
                  : ""}
                <br />
                {g.choices
                  .map(
                    (c) =>
                      `${c.name} (+${money(c.priceMinor)})${c.available ? "" : " — unavailable"}`,
                  )
                  .join(" · ")}
              </p>
            ))}
            {product.modifiers.length > 0 && (
              <p>
                <strong>Customize</strong>
                <br />
                {product.modifiers
                  .map((m) => `${m.name} (+${money(m.priceMinor)})`)
                  .join(" · ")}
              </p>
            )}
            <p>
              <strong>Ingredients</strong> ·{" "}
              {product.ingredients.join(", ") || "Not listed"}
              <br />
              <strong>Known allergens</strong> ·{" "}
              {product.allergens.join(", ") ||
                "None listed; not a safety guarantee"}
            </p>
            <p className="muted">
              Cross-contact and complete allergen safety are not verified. Ask
              staff if needed.
            </p>
            {session && !closed && (
              <button
                className="button secondary"
                disabled={locked}
                onClick={() => {
                  setText(`Tell me about ${product.name} and its options.`);
                  setProductId(null);
                  input.current?.focus();
                }}
              >
                <MessageSquare size={14} />
                Ask {session.job.agentName} about this item
              </button>
            )}
          </div>
        </section>
      )}
      <div className="cashier-columns">
        <section className="panel cashier-conversation">
          <div className="panel-heading">
            <div className="cashier-agent-heading">
              <span className="cashier-agent-avatar">
                <Utensils size={21} />
              </span>
              <div>
                <h2>
                  {session?.job.agentName || overview?.job.agentName || "Alex"}
                  <span className="cashier-agent-role">
                    {session?.job.jobName ||
                      overview?.job.jobName ||
                      "Fast-Food Cashier"}
                  </span>
                </h2>
                <p>{phaseLabel}</p>
              </div>
            </div>
            {session && (
              <button
                className="text-button"
                disabled={locked}
                onClick={() => cashier.start()}
              >
                <Plus size={14} />
                New order
              </button>
            )}
          </div>
          {!session ? (
            <div className="cashier-welcome">
              <span className="cashier-welcome-icon">
                <Utensils size={36} strokeWidth={1.4} />
              </span>
              <span className="eyebrow">YOUR LOCAL AI CASHIER</span>
              <h2>What sounds good today?</h2>
              <p>
                Browse the menu, order in your own words, and watch your cart
                update. Confirm when you’re ready.
              </p>
              <button
                className="button primary"
                disabled={busy || !overview}
                onClick={() => cashier.start()}
              >
                {busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}
                Start ordering
              </button>
              <p className="cashier-footnote">
                Real local model · saved orders · pay at counter
              </p>
              {health && !health.agent.ready && (
                <div className="cashier-setup-notice" role="status">
                  <strong>Set up the local AI first</strong>
                  <p>{health.agent.error}</p>
                  <code>ollama pull {health.agent.model}</code>
                  <button
                    className="text-button"
                    onClick={() => cashier.checkHealth()}
                  >
                    Check again
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="cashier-messages"
                role="log"
                aria-label="Ordering conversation"
                aria-relevant="additions text"
              >
                {session.messages.map((m) => (
                  <div key={m.id} className={`cashier-message ${m.role}`}>
                    <div className="cashier-message-label">
                      {m.role === "user" ? "You" : session.job.agentName}
                      {m.source === "voice" && <Mic size={11} />}
                      {m.source === "backend" && <span>Saved result</span>}
                      <time dateTime={m.at}>
                        {new Date(m.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{m.text}</p>
                    {m.role === "assistant" && (
                      <button
                        className="cashier-speak"
                        onClick={() => voice.speak(m.text)}
                        disabled={locked}
                        aria-label="Read this reply aloud"
                      >
                        <Volume2 size={13} />
                        Listen
                      </button>
                    )}
                  </div>
                ))}
                {session.processing && (
                  <div className="cashier-processing" role="status">
                    <Loader2 size={16} className="spin" />
                    <span>
                      {session.intent}
                      <small>
                        Waiting for the actual model and tool results.
                      </small>
                    </span>
                  </div>
                )}
                <div ref={bottom} />
              </div>
              {voice.error && (
                <div className="cashier-inline-error" role="alert">
                  {voice.error}
                </div>
              )}
              {voice.transcript && (
                <div className="cashier-transcript">
                  <Mic size={13} />
                  <span>Recognized: “{voice.transcript}”</span>
                  <button
                    className="text-button"
                    onClick={() => setText(voice.transcript || "")}
                  >
                    Edit as text
                  </button>
                </div>
              )}
              {session.status === "handoff" ? (
                <div className="cashier-closed">
                  <strong>Your staff-help request is saved locally.</strong>
                  <p>
                    Ask someone at the counter for help. Start a new order to
                    continue.
                  </p>
                </div>
              ) : (
                <form
                  className="cashier-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <label className="sr-only" htmlFor="cashier-message">
                    Message your cashier
                  </label>
                  <textarea
                    ref={input}
                    id="cashier-message"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1500}
                    placeholder={
                      session.order
                        ? "Ask about your order status…"
                        : "Two cheeseburgers and large fries, please…"
                    }
                    rows={2}
                    disabled={locked}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                  />
                  <div className="cashier-composer-controls">
                    <button
                      type="button"
                      className={`button secondary cashier-mic ${voice.phase === "listening" ? "recording" : ""}`}
                      disabled={
                        busy ||
                        session.processing ||
                        ["permission", "transcribing"].includes(voice.phase)
                      }
                      onClick={() => voice.toggle()}
                      aria-label={
                        voice.phase === "listening"
                          ? "Stop microphone recording"
                          : "Record an order with microphone"
                      }
                    >
                      {voice.phase === "listening" ? (
                        <Square size={14} />
                      ) : voice.phase === "transcribing" ||
                        voice.phase === "permission" ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Mic size={15} />
                      )}
                      {voice.phase === "listening" ? "Stop recording" : "Speak"}
                    </button>
                    {voice.phase === "transcribing" && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={voice.cancelRecognition}
                      >
                        Use text instead
                      </button>
                    )}
                    <label className="cashier-voice-toggle">
                      <input
                        type="checkbox"
                        checked={voice.readReplies}
                        onChange={(e) => voice.setReadReplies(e.target.checked)}
                      />
                      Read replies aloud
                    </label>
                    {voice.phase === "speaking" && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={voice.stopSpeaking}
                      >
                        Stop voice
                      </button>
                    )}
                    <button
                      className="button primary"
                      type="submit"
                      disabled={locked || !text.trim()}
                      aria-label="Send cashier message"
                    >
                      <Send size={15} />
                      Send
                    </button>
                  </div>
                  <p className="cashier-footnote">
                    {voice.phase === "listening"
                      ? "Listening · stops after 30 seconds"
                      : voice.phase === "transcribing"
                        ? "Transcribing with local Whisper. Your text input returns when recognition finishes."
                        : voice.phase === "speaking"
                          ? "Browser voice is speaking. Stop voice or press Speak to reply."
                          : "Press Speak, talk, then press Stop. Text is always available. Review your cart before confirming."}
                  </p>
                </form>
              )}
            </>
          )}
        </section>
        <aside className="panel cashier-cart" aria-label="Live order cart">
          <div className="panel-heading">
            <div>
              <h2>Your order</h2>
              <p>
                {session?.order
                  ? "Saved and verified by the backend"
                  : "Updates as your cashier takes the order"}
              </p>
            </div>
            <ShoppingBag size={20} />
          </div>
          {session?.order && (
            <div className="cashier-order-saved">
              <Check size={20} />
              <div>
                <strong>{session.order.number}</strong>
                <span>Kitchen · {session.order.status}</span>
              </div>
              <button className="text-button" onClick={onKitchen}>
                View Kitchen
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          {cart?.items.length ? (
            <>
              <div className="cashier-cart-items">
                {cart.items.map((line, i) => (
                  <div className="cashier-cart-line" key={line.id}>
                    <span className="cashier-line-index">{i + 1}</span>
                    <div>
                      <div className="cashier-line-name">
                        <strong>{line.name}</strong>
                        <span>{money(line.subtotalMinor)}</span>
                      </div>
                      {line.optionLabels.length > 0 && (
                        <p>{line.optionLabels.join(" · ")}</p>
                      )}
                      {line.modifierLabels.length > 0 && (
                        <p className="cashier-modifiers">
                          {line.modifierLabels.join(" · ")}
                        </p>
                      )}
                      <div className="cashier-quantity">
                        <button
                          disabled={
                            locked ||
                            closed ||
                            line.quantity <= 1 ||
                            !session!.job.enabledTools.includes(
                              "update_cart_item",
                            )
                          }
                          aria-label={`Decrease quantity of item ${i + 1}`}
                          onClick={() =>
                            cashier.cartAction("update_cart_item", {
                              lineId: line.id,
                              quantity: line.quantity - 1,
                            })
                          }
                        >
                          <Minus size={12} />
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          disabled={
                            locked ||
                            closed ||
                            line.quantity >= 10 ||
                            !session!.job.enabledTools.includes(
                              "update_cart_item",
                            )
                          }
                          aria-label={`Increase quantity of item ${i + 1}`}
                          onClick={() =>
                            cashier.cartAction("update_cart_item", {
                              lineId: line.id,
                              quantity: line.quantity + 1,
                            })
                          }
                        >
                          <Plus size={12} />
                        </button>
                        <small>{money(line.unitMinor)} each</small>
                        {!closed && (
                          <button
                            className="cashier-remove"
                            disabled={
                              locked ||
                              !session!.job.enabledTools.includes(
                                "remove_from_cart",
                              )
                            }
                            aria-label={`Remove item ${i + 1}: ${line.name}`}
                            onClick={() =>
                              cashier.cartAction("remove_from_cart", {
                                lineId: line.id,
                              })
                            }
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cashier-order-details">
                <label>
                  Fulfillment
                  <select
                    value={cart.fulfillmentType}
                    disabled={
                      locked ||
                      closed ||
                      !session!.job.enabledTools.includes("set_order_details")
                    }
                    onChange={(e) =>
                      cashier.cartAction("set_order_details", {
                        fulfillmentType: e.target.value,
                      })
                    }
                  >
                    {session!.job.fulfillmentTypes.map((f) => (
                      <option key={f} value={f}>
                        {f === "pickup"
                          ? "Pickup · pay at counter"
                          : "Dine in · pay at counter"}
                      </option>
                    ))}
                  </select>
                </label>
                {cart.specialInstructions && (
                  <p>
                    <strong>Kitchen note:</strong> {cart.specialInstructions}
                  </p>
                )}
              </div>
              <div className="cashier-totals">
                <div>
                  <span>Subtotal</span>
                  <span>{money(cart.subtotalMinor)}</span>
                </div>
                <div>
                  <span>
                    Tax ({(session!.job.taxBasisPoints / 100).toFixed(2)}%)
                  </span>
                  <span>{money(cart.taxMinor)}</span>
                </div>
                <div className="cashier-total">
                  <strong>Total</strong>
                  <strong>{money(cart.totalMinor)}</strong>
                </div>
                <p>Unpaid · payment at the counter</p>
              </div>
              {cart.issues.length > 0 && (
                <div className="cashier-inline-error" role="alert">
                  {cart.issues.join(" ")}
                </div>
              )}
              {!closed && (
                <div className="cashier-review">
                  {quoteValid ? (
                    <>
                      <span className="eyebrow">REVIEW BEFORE CONFIRMING</span>
                      <p>
                        Confirm these exact items and{" "}
                        {money(session!.quote!.cart.totalMinor)} total. This
                        sends an unpaid order to the local Kitchen.
                      </p>
                      <button
                        className="button primary"
                        disabled={
                          locked ||
                          !!cart.issues.length ||
                          !session!.job.enabledTools.includes("confirm_order")
                        }
                        onClick={() => cashier.confirm()}
                      >
                        <Check size={16} />
                        Confirm order · {money(session!.quote!.cart.totalMinor)}
                      </button>
                      <small>Changing an item requires a new review.</small>
                    </>
                  ) : (
                    <>
                      <p>
                        {session?.quote
                          ? "The menu or review changed. Check the current items and review again."
                          : "When you’re done, tell your cashier or review your order here."}
                      </p>
                      <button
                        className="button secondary"
                        disabled={
                          locked ||
                          !!cart.issues.length ||
                          !session!.job.enabledTools.includes(
                            "calculate_order_total",
                          )
                        }
                        onClick={() =>
                          cashier.cartAction("calculate_order_total", {})
                        }
                      >
                        Review order
                        <ArrowRight size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
              {session?.order && (
                <div className="cashier-review">
                  <button
                    className="button secondary"
                    disabled={locked}
                    onClick={() => cashier.start()}
                  >
                    Start another order
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="cashier-empty-cart">
              <ShoppingBag size={30} strokeWidth={1.4} />
              <h3>Good things go here.</h3>
              <p>
                Tell your cashier what you’d like. Your items, choices, and real
                total will appear here.
              </p>
              <button className="text-button" onClick={() => setShowMenu(true)}>
                See the menu
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="cashier-cart-footer">
            <ChefHat size={14} />
            Local Kitchen · no payment collected
          </div>
        </aside>
      </div>
    </div>
  );
}
