"use client";
import { useState } from "react";
import {
  ArrowRight,
  ChefHat,
  Check,
  Clock,
  List,
  ShoppingBag,
} from "lucide-react";
import { CashierController } from "@/hooks/use-cashier";
import { money, orderStatuses, RestaurantOrder } from "@/lib/cashier";
import { MenuEditor } from "./cashier-menu-editor";

const statusLabels = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
};
function OrderCard({
  order,
  cashier,
}: {
  order: RestaurantOrder;
  cashier: CashierController;
}) {
  const next = orderStatuses[orderStatuses.indexOf(order.status) + 1];
  return (
    <article className={`panel kitchen-card kitchen-${order.status}`}>
      <div className="kitchen-card-heading">
        <div>
          <strong>{order.number}</strong>
          <span>
            <Clock size={12} />
            <time dateTime={order.createdAt}>
              {new Date(order.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>{" "}
            · {order.cart.fulfillmentType === "pickup" ? "Pickup" : "Dine in"}
          </span>
        </div>
        <span className={`kitchen-status ${order.status}`}>
          {statusLabels[order.status]}
        </span>
      </div>
      <div className="kitchen-items">
        {order.cart.items.map((item, i) => (
          <div key={item.id}>
            <span>{item.quantity}×</span>
            <div>
              <strong>{item.name}</strong>
              <small>
                Item {i + 1}
                {item.optionLabels.length
                  ? ` · ${item.optionLabels.join(" · ")}`
                  : ""}
              </small>
              {item.modifierLabels.length > 0 && (
                <p>{item.modifierLabels.join(" · ")}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {order.cart.specialInstructions && (
        <div className="kitchen-note">
          <strong>Kitchen note</strong>
          <p>{order.cart.specialInstructions}</p>
        </div>
      )}
      <div className="kitchen-card-footer">
        <div>
          <strong>{money(order.cart.totalMinor)}</strong>
          <span>Unpaid · pay at counter</span>
        </div>
        {next ? (
          <button
            className={`button ${next === "ready" ? "primary" : "secondary"}`}
            disabled={cashier.busy}
            onClick={() => cashier.advanceOrder(order)}
          >
            {next === "preparing"
              ? "Start preparing"
              : next === "ready"
                ? "Mark ready"
                : "Complete"}
            <ArrowRight size={14} />
          </button>
        ) : (
          <span className="positive">
            <Check size={14} />
            Completed
          </span>
        )}
      </div>
    </article>
  );
}
export function CashierOperations({
  cashier,
  initialTab = "kitchen",
}: {
  cashier: CashierController;
  initialTab?: "kitchen" | "menu";
}) {
  const [tab, setTab] = useState<"kitchen" | "orders" | "menu">(initialTab);
  const [filter, setFilter] = useState("active");
  const orders = cashier.overview?.orders || [];
  const filtered = orders.filter(
    (o) =>
      filter === "all" ||
      (filter === "active" ? o.status !== "completed" : o.status === filter),
  );
  return (
    <div className="cashier-feature">
      <div className="cashier-operations-toolbar">
        <div className="segmented-control" aria-label="Restaurant operations">
          {[
            ["kitchen", "Kitchen", ChefHat],
            ["orders", "Orders", ShoppingBag],
            ["menu", "Menu", List],
          ].map(([key, label, Icon]) => {
            const Symbol = Icon as typeof ChefHat;
            return (
              <button
                key={key as string}
                className={tab === key ? "selected" : ""}
                aria-pressed={tab === key}
                onClick={() => setTab(key as typeof tab)}
              >
                <Symbol size={15} />
                {label as string}
              </button>
            );
          })}
        </div>
        {tab !== "menu" && (
          <label className="cashier-filter">
            Show
            <select
              aria-label="Filter kitchen orders"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">
                Active orders (
                {orders.filter((o) => o.status !== "completed").length})
              </option>
              <option value="all">All orders</option>
              {orderStatuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {tab === "menu" ? (
        cashier.overview && <MenuEditor cashier={cashier} />
      ) : (
        <>
          <div className="cashier-kitchen-intro">
            <h2>
              {tab === "kitchen"
                ? "Your local kitchen queue"
                : "Saved restaurant orders"}
            </h2>
            <p>
              Confirmed orders appear here automatically. Advance New →
              Preparing → Ready → Completed.
            </p>
          </div>
          {filtered.length ? (
            <div className="kitchen-grid">
              {filtered.map((order) => (
                <OrderCard key={order.id} order={order} cashier={cashier} />
              ))}
            </div>
          ) : (
            <div className="panel cashier-operations-empty">
              <ChefHat size={32} strokeWidth={1.3} />
              <h2>
                {orders.length
                  ? "No orders in this view."
                  : "The next order starts at the cashier."}
              </h2>
              <p>
                {orders.length
                  ? "Choose a different status to see saved orders."
                  : "Take an order, review its exact total, and confirm it. The same saved order will appear here."}
              </p>
            </div>
          )}
          {!!cashier.overview?.handoffs.length && (
            <section className="panel cashier-handoffs">
              <div className="panel-heading">
                <div>
                  <h2>Staff help requested</h2>
                  <p>Local records · no external notification is sent</p>
                </div>
                <span className="count-tag">
                  {cashier.overview.handoffs.length}
                </span>
              </div>
              {cashier.overview.handoffs.map((h) => (
                <div key={h.id}>
                  <span>{h.category.replaceAll("_", " ")}</span>
                  <p>{h.reason}</p>
                  <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
