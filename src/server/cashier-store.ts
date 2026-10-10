import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  CashierEvent,
  CashierJob,
  CashierOverview,
  CashierSession,
  CashierSessionView,
  Handoff,
  MenuProduct,
  PricedCart,
  RestaurantOrder,
  orderStatuses,
} from "../lib/cashier";
import { DemoError } from "./errors";
import { jobSchema, menuWriteSchema } from "./cashier-schema";
import { seedCashier } from "./cashier-seed";

export type SessionRecord = CashierSession & { tokenHash: string };
export type CashierState = {
  version: 1;
  revision: number;
  menuRevision: number;
  nextOrderNumber: number;
  job: CashierJob;
  products: MenuProduct[];
  sessions: SessionRecord[];
  orders: RestaurantOrder[];
  handoffs: Handoff[];
};
type Runtime = { state: CashierState; file: string };
const global = globalThis as typeof globalThis & { __relayCashier?: Runtime };
export const cashierId = (prefix: string) =>
  `${prefix}_${randomBytes(prefix === "line" ? 8 : 16).toString("hex")}`;
export const cashierNow = () => new Date().toISOString();
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function persist(file: string, state: CashierState) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(state));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
function runtime(): Runtime {
  const directory = path.resolve(
    /* turbopackIgnore: true */ process.env.CASHIER_DATA_DIR ||
      path.join(process.cwd(), ".cashier-data"),
  );
  const file = path.join(directory, "state.json");
  if (global.__relayCashier?.file === file) return global.__relayCashier;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state: CashierState = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : seedCashier();
  if (state.version !== 1)
    throw new Error(
      "Unsupported cashier data version. Restore a compatible backup.",
    );
  for (const session of state.sessions) {
    if (session.processing) {
      session.processing = false;
      delete session.approval;
      for (const turn of session.turns.filter((t) => t.status === "running")) {
        turn.status = "interrupted";
        turn.completedAt = cashierNow();
        turn.error =
          "The server restarted. Review the saved cart before sending another message.";
      }
      cashEvent(
        session,
        "error",
        "Server restarted; saved orders and cart actions were preserved",
      );
    }
  }
  persist(file, state);
  global.__relayCashier = { state, file };
  return global.__relayCashier;
}
export function cashierSnapshot(): CashierState {
  return structuredClone(runtime().state);
}
export function cashierMutate<T>(fn: (state: CashierState) => T): T {
  const rt = runtime();
  const next = structuredClone(rt.state);
  const result = fn(next);
  next.revision += 1;
  persist(rt.file, next);
  rt.state = next;
  return structuredClone(result);
}
export function cashEvent(
  session: CashierSession,
  stage: CashierEvent["stage"],
  label: string,
  metadata: unknown = {},
  turnId?: string,
) {
  session.updatedAt = cashierNow();
  session.events.push({
    id: cashierId("event"),
    at: session.updatedAt,
    stage,
    label,
    metadata,
    ...(turnId ? { turnId } : {}),
  });
}
export function findSession(state: CashierState, id: string): SessionRecord {
  const session = state.sessions.find((s) => s.id === id);
  if (!session)
    throw new DemoError(
      "SESSION_NOT_FOUND",
      "Ordering session not found.",
      404,
    );
  return session;
}
export function authorizeSession(
  id: string,
  token: string,
  state = cashierSnapshot(),
) {
  const session = findSession(state, id);
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !timingSafeEqual(
      Buffer.from(session.tokenHash, "hex"),
      Buffer.from(digest(token), "hex"),
    )
  )
    throw new DemoError(
      "SESSION_UNAUTHORIZED",
      "This browser is not authorized for that ordering session.",
      403,
    );
  return session;
}
export function findProduct(state: CashierState, id: string) {
  const product = state.products.find((p) => p.id === id);
  if (!product)
    throw new DemoError(
      "PRODUCT_NOT_FOUND",
      "That product is not on the current menu.",
      404,
    );
  return product;
}
export function normalizeCustomization(
  product: MenuProduct,
  selected: Record<string, string>,
  modifications: string[],
) {
  const selections = { ...selected };
  for (const key of Object.keys(selections))
    if (!product.options.some((g) => g.id === key))
      throw new DemoError(
        "INVALID_SELECTION",
        `Unknown option ${key} for ${product.name}.`,
      );
  for (const group of product.options) {
    if (!selections[group.id] && group.defaultChoiceId)
      selections[group.id] = group.defaultChoiceId;
    if (!selections[group.id] && group.required)
      throw new DemoError(
        "SELECTION_REQUIRED",
        `${product.name} needs a ${group.name} selection: ${group.choices
          .filter((c) => c.available)
          .map((c) => `${c.name} (${c.id})`)
          .join(", ")}.`,
      );
    if (
      selections[group.id] &&
      !group.choices.some((c) => c.id === selections[group.id] && c.available)
    )
      throw new DemoError(
        "OPTION_UNAVAILABLE",
        `Choose an available ${group.name} for ${product.name}.`,
      );
  }
  if (
    new Set(modifications).size !== modifications.length ||
    modifications.some((id) => !product.modifiers.some((m) => m.id === id))
  )
    throw new DemoError(
      "INVALID_MODIFIER",
      `Choose supported modifications for ${product.name}: ${product.modifiers.map((m) => m.id).join(", ")}.`,
    );
  if (
    modifications.some(
      (id) =>
        id.startsWith("no_") && modifications.includes(`extra_${id.slice(3)}`),
    )
  )
    throw new DemoError(
      "CONFLICTING_MODIFIERS",
      "An ingredient cannot be removed and added as an extra at the same time.",
    );
  return { selections, modifications };
}
export function priceCart(
  state: CashierState,
  session: CashierSession,
): PricedCart {
  const issues: string[] = [];
  const items: PricedCart["items"] = [];
  for (const line of session.cart.items) {
    try {
      const product = findProduct(state, line.productId);
      if (!product.available)
        throw new DemoError(
          "PRODUCT_UNAVAILABLE",
          `${product.name} is currently unavailable.`,
        );
      const custom = normalizeCustomization(
        product,
        line.selections,
        line.modifications,
      );
      const choices = product.options.flatMap((g) =>
        g.choices.filter((c) => c.id === custom.selections[g.id]),
      );
      const modifiers = product.modifiers.filter((m) =>
        custom.modifications.includes(m.id),
      );
      const unitMinor =
        product.priceMinor +
        choices.reduce((s, c) => s + c.priceMinor, 0) +
        modifiers.reduce((s, m) => s + m.priceMinor, 0);
      items.push({
        ...line,
        name: product.name,
        optionLabels: choices.map((c) => c.name),
        modifierLabels: modifiers.map((m) => m.name),
        unitMinor,
        subtotalMinor: unitMinor * line.quantity,
      });
    } catch (error) {
      issues.push(
        error instanceof DemoError
          ? error.message
          : "An item could not be priced.",
      );
      items.push({
        ...line,
        name:
          state.products.find((p) => p.id === line.productId)?.name ||
          "Unavailable product",
        optionLabels: [],
        modifierLabels: [],
        unitMinor: 0,
        subtotalMinor: 0,
      });
    }
  }
  if (!session.job.fulfillmentTypes.includes(session.cart.fulfillmentType))
    issues.push("Choose an enabled fulfillment type.");
  const count = items.reduce((s, x) => s + x.quantity, 0);
  if (count > session.job.maxCartItems)
    issues.push(`Orders are limited to ${session.job.maxCartItems} items.`);
  const subtotalMinor = items.reduce((s, x) => s + x.subtotalMinor, 0);
  const taxMinor = Math.floor(
    (subtotalMinor * session.job.taxBasisPoints + 5000) / 10000,
  );
  return {
    items,
    fulfillmentType: session.cart.fulfillmentType,
    specialInstructions: session.cart.specialInstructions,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    currency: session.job.currency,
    issues,
    revision: session.cart.revision,
  };
}
export function sessionCart(
  state: CashierState,
  session: CashierSession,
): PricedCart {
  if (!session.orderId) return priceCart(state, session);
  const order = state.orders.find((o) => o.id === session.orderId);
  if (!order)
    throw new DemoError(
      "ORDER_NOT_FOUND",
      "The saved order record cannot be found. Check the local restaurant data.",
      500,
    );
  return order.cart;
}
export function sessionView(id: string): CashierSessionView {
  const state = cashierSnapshot();
  const record = findSession(state, id);
  const { tokenHash: _secret, ...session } = record;
  void _secret;
  const quoteValid =
    !!session.quote &&
    session.quote.cartRevision === session.cart.revision &&
    session.quote.menuRevision === state.menuRevision &&
    Date.parse(session.quote.expiresAt) > Date.now();
  return {
    ...session,
    pricedCart: sessionCart(state, session),
    order: state.orders.find((o) => o.id === session.orderId),
    quoteValid,
  };
}
export function cashierOverview(): CashierOverview {
  const state = cashierSnapshot();
  return {
    revision: state.revision,
    menuRevision: state.menuRevision,
    job: state.job,
    products: state.products,
    orders: state.orders.slice().reverse(),
    handoffs: state.handoffs.slice().reverse(),
    sessions: state.sessions
      .slice(-30)
      .reverse()
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        status: s.status,
        processing: s.processing,
        orderId: s.orderId,
        agentName: s.job.agentName,
      })),
  };
}
export function createSession(provider: string, model: string) {
  const token = randomBytes(32).toString("base64url");
  const id = cashierMutate((state) => {
    if (state.sessions.length >= 1000)
      throw new DemoError(
        "SESSION_LIMIT",
        "The local demo has reached its session limit. Archive its data before starting a fresh workspace.",
        409,
      );
    const now = cashierNow();
    const session: SessionRecord = {
      id: cashierId("session"),
      tokenHash: digest(token),
      createdAt: now,
      updatedAt: now,
      job: structuredClone(state.job),
      status: "draft",
      processing: false,
      intent: "Ready to take an order",
      cart: {
        revision: 0,
        items: [],
        fulfillmentType: state.job.fulfillmentTypes[0],
        specialInstructions: "",
      },
      provider,
      model,
      messages: [
        {
          id: cashierId("msg"),
          role: "assistant",
          text: state.job.greeting,
          source: "configuration",
          at: now,
        },
      ],
      turns: [],
      events: [],
      tools: [],
    };
    cashEvent(session, "received", "Ordering session started", {
      provider,
      model,
      jobVersion: session.job.version,
    });
    state.sessions.push(session);
    return session.id;
  });
  return { token, session: sessionView(id) };
}
export function saveJob(input: unknown) {
  const job = jobSchema.parse(input);
  return cashierMutate((state) => {
    if (job.version !== state.job.version)
      throw new DemoError(
        "SETTINGS_CHANGED",
        "Settings changed in another window. Reload before saving.",
        409,
      );
    state.job = { ...job, version: state.job.version + 1 };
    return state.job;
  });
}
export function saveMenu(input: unknown) {
  const menu = menuWriteSchema.parse(input);
  return cashierMutate((state) => {
    if (menu.revision !== state.menuRevision)
      throw new DemoError(
        "MENU_CHANGED",
        "The menu changed in another window. Reload before saving.",
        409,
      );
    state.products = menu.products;
    state.menuRevision += 1;
    return { products: state.products, revision: state.menuRevision };
  });
}
export function updateKitchen(
  id: string,
  status: RestaurantOrder["status"],
  version: number,
) {
  return cashierMutate((state) => {
    const order = state.orders.find((o) => o.id === id);
    if (!order) throw new DemoError("ORDER_NOT_FOUND", "Order not found.", 404);
    if (order.status === status) return order;
    if (order.statusVersion !== version)
      throw new DemoError(
        "ORDER_CHANGED",
        "Another kitchen screen updated this order. Refresh and try again.",
        409,
      );
    if (
      orderStatuses.indexOf(status) !==
      orderStatuses.indexOf(order.status) + 1
    )
      throw new DemoError(
        "INVALID_ORDER_TRANSITION",
        "Advance orders from New to Preparing to Ready to Completed.",
        409,
      );
    order.status = status;
    order.statusVersion += 1;
    order.updatedAt = cashierNow();
    cashEvent(
      findSession(state, order.sessionId),
      "kitchen",
      `Kitchen marked ${order.number} ${status}`,
      { orderId: order.id, status },
    );
    return order;
  });
}
export function verifyStoredOrder(id: string) {
  const state = JSON.parse(
    fs.readFileSync(runtime().file, "utf8"),
  ) as CashierState;
  const order = state.orders.find((o) => o.id === id);
  if (!order)
    throw new DemoError(
      "ORDER_VERIFICATION_FAILED",
      "The saved order could not be verified. Refresh before trying again.",
      500,
    );
  return order;
}
// The model cannot grant approval. This narrowly recognizes standalone affirmative
// text after a displayed quote; arbitrary language always has the explicit UI button.
export function explicitAffirmation(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ");
  return /^(yes|yes,? please|yes,? (please )?(confirm( (my|the|this))? order|book it|place (my|the|this) order|go ahead)|confirm (my|the|this) order|place (my|the|this) order|go ahead|evet|evet,? lütfen|evet,? (onaylıyorum|siparişi onaylıyorum)|siparişi onaylıyorum|onaylıyorum)$/.test(
    normalized,
  );
}
export function beginTurn(
  id: string,
  token: string,
  text: string,
  requestId: string,
  source: "text" | "voice" = "text",
  approvedQuoteId?: string,
) {
  authorizeSession(id, token);
  return cashierMutate((state) => {
    const session = findSession(state, id);
    const prior = session.turns.find((t) => t.requestId === requestId);
    if (prior) {
      if (
        prior.text !== text ||
        prior.source !== source ||
        prior.approvedQuoteId !== approvedQuoteId
      )
        throw new DemoError(
          "REQUEST_ID_REUSED",
          "Use a new message ID for a different request.",
          409,
        );
      return { turnId: prior.id, replayed: true };
    }
    if (session.processing)
      throw new DemoError(
        "AGENT_BUSY",
        "Wait for the current reply before sending another request.",
        409,
      );
    if (session.turns.length >= 100)
      throw new DemoError(
        "CONVERSATION_LIMIT",
        "Start a new session to continue. Existing orders remain saved.",
        409,
      );
    const turnId = cashierId("turn");
    const at = cashierNow();
    delete session.approval;
    const quoteId =
      approvedQuoteId ||
      (source === "text" && explicitAffirmation(text)
        ? session.quote?.id
        : undefined);
    if (quoteId && session.quote?.id === quoteId)
      session.approval = { quoteId, turnId };
    session.turns.push({
      id: turnId,
      requestId,
      text,
      source,
      status: "running",
      startedAt: at,
      messages: [{ role: "user", content: text }],
      ...(approvedQuoteId ? { approvedQuoteId } : {}),
    });
    session.messages.push({
      id: cashierId("msg"),
      role: "user",
      text,
      source,
      at,
    });
    session.processing = true;
    cashEvent(
      session,
      "received",
      source === "voice"
        ? "Recognized speech received"
        : "Customer message received",
      { source },
      turnId,
    );
    if (session.approval)
      cashEvent(
        session,
        "review",
        "Customer explicitly approved the displayed order",
        { quoteId },
        turnId,
      );
    return { turnId, replayed: false };
  });
}
export function finishTurn(
  id: string,
  turnId: string,
  text: string,
  error?: string,
  source: "model" | "backend" = "model",
) {
  return cashierMutate((state) => {
    const session = findSession(state, id);
    const turn = session.turns.find((t) => t.id === turnId)!;
    turn.status = error ? "failed" : "completed";
    turn.error = error;
    turn.completedAt = cashierNow();
    turn.reply = text;
    session.processing = false;
    delete session.approval;
    session.messages.push({
      id: cashierId("msg"),
      role: "assistant",
      text,
      source,
      at: cashierNow(),
    });
    cashEvent(
      session,
      error ? "error" : "response",
      error ? "Agent could not complete this turn" : "Reply saved",
      error ? { error } : { source },
      turnId,
    );
  });
}
