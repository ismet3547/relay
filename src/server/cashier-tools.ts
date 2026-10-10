import { z } from "zod";
import { CashierTool, MenuProduct, ToolExecution, money } from "../lib/cashier";
import { DemoError } from "./errors";
import { toolSchemas } from "./cashier-schema";
import {
  authorizeSession,
  cashierId,
  cashierMutate,
  cashierNow,
  cashierSnapshot,
  cashEvent,
  digest,
  findProduct,
  findSession,
  normalizeCustomization,
  priceCart,
  sessionCart,
  verifyStoredOrder,
} from "./cashier-store";

export type ToolContext = {
  sessionId: string;
  token: string;
  turnId: string;
  actor: "model" | "customer" | "backend";
};
export type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; error: string };
const descriptions: Record<CashierTool, string> = {
  get_menu:
    "Read the current stored menu and real product IDs, names/aliases, prices, options, modifications, and availability. Fetch before ordering. Match customer wording to a product name/alias; do not choose an unrelated product from the same category. Optional category/search filters.",
  get_product_details:
    "Read one real product's selections, extras, known ingredients and allergens. Never guarantee allergen safety.",
  check_product_availability:
    "Check whether a real menu product is available now.",
  add_to_cart:
    "Add a product with an explicit quantity. For quantity > 1, modifiers MUST use unitCustomizations with 1-based unit numbers; customize only the intended units. Unmentioned units stay plain. Top-level selections are shared defaults; unit selections override them. Alternatively add plain units then update exact line IDs. Use menu IDs and declared defaults. Never choose an unknown option or price.",
  update_cart_item:
    "Change an exact line ID from get_cart. Selections merge with current selections; modifications REPLACE the whole modifier list. Quantity changes apply ONLY to that line, not to all lines of that product. Setting an existing quantity of 1 to 1 removes nothing; use remove_from_cart to remove a unit line. Ask if the reference is ambiguous.",
  remove_from_cart:
    "Delete one exact cart line ID. Each separately added unit has its own line: to remove one of two quantity-1 burgers, delete just one line. Read get_cart to resolve the reference. Ask if ambiguous.",
  get_cart:
    "Read the actual cart, line IDs in ordering sequence, quantities, selections and backend-calculated prices.",
  calculate_order_total:
    "Validate and reprice the cart, create an exact displayed order quote, and ask the customer to confirm it. This NEVER submits an order. Invoke when the customer is done ordering or asks to review the total.",
  confirm_order:
    "Submit the displayed quote ONLY after backend-recorded explicit customer approval. The model cannot grant approval. Use the current quote ID. No approval or a changed cart/menu causes rejection. Returns the real persisted, verified unpaid order.",
  get_order_status:
    "Read this session's real saved order and latest kitchen status. Cannot inspect other sessions.",
  request_human_handoff:
    "Create a local staff-help record for refunds, payment disputes, unsupported requests or uncertain allergen questions. Does not notify a real employee.",
  set_order_details:
    "Change pickup/dine-in fulfillment or short kitchen instructions, within configured rules. Invalidates prior order review.",
};
export function toolDefinitions(
  enabled: CashierTool[],
  products?: MenuProduct[],
) {
  // Present the model with real identifiers and named option fields, rather
  // than an unconstrained dictionary that can be mistaken for instructions.
  // Live domain validation remains authoritative for every executed operation.
  const groups = new Map<string, Set<string>>();
  for (const product of products || []) {
    for (const group of product.options) {
      const choices = groups.get(group.id) || new Set<string>();
      for (const choice of group.choices)
        if (choice.available) choices.add(choice.id);
      groups.set(group.id, choices);
    }
  }
  const selections = {
    type: "object" as const,
    description:
      "Menu option group IDs mapped to ONE choice ID string each, e.g. size or drink. Never put ingredient removals, unit numbers or arrays here. Omit unrequested options to use menu defaults.",
    properties: Object.fromEntries(
      [...groups].map(([id, choices]) => [
        id,
        { type: "string" as const, enum: [...choices] },
      ]),
    ),
    additionalProperties: false,
  };
  const modifications = {
    type: "array" as const,
    description:
      "Ingredient removal/extra modifier IDs supported by the selected product. Empty or omitted means no requested modifiers. Never use size or drink choices here.",
    items: {
      type: "string" as const,
      enum: [
        ...new Set(products?.flatMap((p) => p.modifiers.map((m) => m.id))),
      ],
    },
    maxItems: 12,
    uniqueItems: true,
  };
  return enabled.map((name) => {
    const parameters = z.toJSONSchema(toolSchemas[name], {
      unrepresentable: "any",
    });
    delete parameters.$schema;
    if (products && parameters.properties) {
      const fields = parameters.properties;
      const objectField = (key: string) => {
        const field = fields[key];
        return field && typeof field === "object" ? field : undefined;
      };
      if (objectField("productId"))
        fields.productId = {
          type: "string",
          enum: products.map((p) => p.id),
          description:
            "Exact ID of the requested menu product. Read availability and supported options from CURRENT MENU.",
        };
      if (fields.selections) fields.selections = selections;
      if (fields.modifications) fields.modifications = { ...modifications };
      if (name === "add_to_cart") {
        fields.modifications = {
          ...modifications,
          description:
            modifications.description +
            " Top-level modifiers are for quantity 1 only; for multiple units use unitCustomizations.",
        };
        fields.unitCustomizations = {
          ...objectField("unitCustomizations"),
          items: {
            type: "object",
            properties: {
              unit: {
                type: "integer",
                minimum: 1,
                maximum: 10,
                description:
                  "1-based position within this addition: first=1, second=2, last=quantity. Customize only the requested units.",
              },
              selections,
              modifications: {
                ...modifications,
                description:
                  "Modifier IDs for only this unit. Unmentioned units stay plain.",
              },
            },
            required: ["unit"],
            additionalProperties: false,
          },
        };
      }
      // Line and quote IDs come from live state/tool results. Encoding changing
      // IDs in the tool schemas would invalidate Ollama's entire cached prefix
      // after every cart change. The backend still enforces ownership/approval.
    }
    return {
      type: "function" as const,
      function: { name, description: descriptions[name], parameters },
    };
  });
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function executeCashierTool(
  context: ToolContext,
  name: string,
  raw: unknown,
): ToolResult {
  const session = authorizeSession(context.sessionId, context.token);
  if (
    context.actor !== "customer" &&
    !session.turns.some(
      (t) => t.id === context.turnId && t.status === "running",
    )
  )
    throw new DemoError(
      "TURN_UNAUTHORIZED",
      "Tool calls must belong to the current customer turn.",
      403,
    );
  const startedAt = cashierNow();
  const argumentsHash = digest(stable(raw));
  const key = `${context.turnId}:${name}:${argumentsHash}`;
  // Reads must observe later mutations in the same inference loop. Only replay
  // identical writes; caching get_cart or calculate_order_total would be stale.
  const writes = [
    "add_to_cart",
    "update_cart_item",
    "remove_from_cart",
    "set_order_details",
    "confirm_order",
    "request_human_handoff",
  ];
  const prior = writes.includes(name)
    ? session.tools.find((t) => t.key === key)
    : undefined;
  if (prior && context.actor !== "backend") return prior.result as ToolResult;
  let result: ToolResult;
  try {
    if (context.actor === "backend" && !["get_menu", "get_cart"].includes(name))
      throw new DemoError(
        "BACKEND_READ_ONLY",
        "Server context loading permits menu/cart reads only.",
        403,
      );
    if (
      !(name in toolSchemas) ||
      !session.job.enabledTools.includes(name as CashierTool)
    )
      throw new DemoError(
        "TOOL_NOT_PERMITTED",
        "That operation is not enabled for this AI job.",
        403,
      );
    const schema = toolSchemas[name as CashierTool];
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new DemoError(
        "INVALID_TOOL_ARGUMENTS",
        parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "arguments"}: ${issue.message}`,
          )
          .join(" ") +
          (["add_to_cart", "update_cart_item"].includes(name)
            ? " selections maps option group IDs (such as size/drink) to single choice ID strings. Ingredient removals/extras belong in modifications; specific units belong in unitCustomizations. Read the menu for exact supported IDs."
            : ""),
      );
    result = cashierMutate((state) => {
      const current = authorizeSession(context.sessionId, context.token, state);
      const args = parsed.data as Record<string, unknown>;
      const mutable = () => {
        if (current.status === "confirmed" || current.status === "handoff")
          throw new DemoError(
            "CART_CLOSED",
            "This order session is closed for changes. Start a new order.",
            409,
          );
      };
      const changed = () => {
        current.cart.revision += 1;
        current.status = "draft";
        delete current.quote;
        delete current.approval;
        current.intent = "Building the order";
        cashEvent(
          current,
          "cart",
          "Cart updated in local storage",
          { revision: current.cart.revision, operation: name },
          context.turnId,
        );
      };
      let value: unknown;
      if (name === "get_menu") {
        const needle = String(args.search || "").toLocaleLowerCase();
        value = {
          currency: current.job.currency,
          menuRevision: state.menuRevision,
          taxBasisPoints: current.job.taxBasisPoints,
          readOnly: true,
          note: "Reading the menu does not add items. For a concrete customer order, use add_to_cart now with these IDs. Optional declared defaults do not need another question.",
          products: state.products
            .filter(
              (p) =>
                (!args.category || p.category === args.category) &&
                (!needle ||
                  [p.name, ...p.aliases].some((n) =>
                    n.toLocaleLowerCase().includes(needle),
                  )),
            )
            .map((p) => ({
              id: p.id,
              name: p.name,
              aliases: p.aliases,
              category: p.category,
              priceMinor: p.priceMinor,
              available: p.available,
              options: p.options,
              modifiers: p.modifiers,
            })),
        };
      } else if (
        name === "get_product_details" ||
        name === "check_product_availability"
      ) {
        const product = findProduct(state, String(args.productId));
        value =
          name === "get_product_details"
            ? {
                product,
                allergenNotice:
                  "Listed ingredients are informational; cross-contact and complete allergen safety are not verified. Ask staff if needed.",
              }
            : { productId: product.id, available: product.available };
      } else if (name === "get_cart")
        value = {
          cart: sessionCart(state, current),
          quote: current.quote,
          orderId: current.orderId,
        };
      else if (name === "add_to_cart") {
        mutable();
        const product = findProduct(state, String(args.productId));
        if (!product.available)
          throw new DemoError(
            "PRODUCT_UNAVAILABLE",
            `${product.name} is sold out. Ask before choosing an alternative.`,
            409,
          );
        const quantity = Number(args.quantity);
        if (
          current.cart.items.reduce((s, x) => s + x.quantity, 0) + quantity >
          current.job.maxCartItems
        )
          throw new DemoError(
            "CART_LIMIT",
            `Orders are limited to ${current.job.maxCartItems} items.`,
            409,
          );
        const units = (args.unitCustomizations || []) as {
          unit: number;
          selections?: Record<string, string>;
          modifications?: string[];
        }[];
        const lines = Array.from({ length: quantity }, (_, index) => {
          const unit = units.find((c) => c.unit === index + 1);
          const custom = normalizeCustomization(
            product,
            {
              ...((args.selections || {}) as Record<string, string>),
              ...unit?.selections,
            },
            unit?.modifications ?? ((args.modifications || []) as string[]),
          );
          return {
            id: cashierId("line"),
            productId: product.id,
            quantity: 1,
            ...custom,
          };
        });
        current.cart.items.push(...lines);
        changed();
        value = {
          addedLineIds: lines.map((l) => l.id),
          customizationScope:
            "addedLineIds are ordered by the 1-based unit number in this addition. Each unit's actual selections and modifiers are shown in cart. Use an exact lineId to make further changes.",
          cart: priceCart(state, current),
        };
      } else if (name === "update_cart_item" || name === "remove_from_cart") {
        mutable();
        const line = current.cart.items.find((i) => i.id === args.lineId);
        if (!line)
          throw new DemoError(
            "LINE_NOT_FOUND",
            "That cart line no longer exists. Read the current cart first.",
            404,
          );
        if (name === "remove_from_cart")
          current.cart.items = current.cart.items.filter(
            (i) => i.id !== line.id,
          );
        else {
          const product = findProduct(state, line.productId);
          if (!product.available)
            throw new DemoError(
              "PRODUCT_UNAVAILABLE",
              `${product.name} is unavailable. Remove it or ask for an alternative.`,
              409,
            );
          const custom = normalizeCustomization(
            product,
            {
              ...line.selections,
              ...((args.selections as Record<string, string>) || {}),
            },
            (args.modifications as string[] | undefined) ?? line.modifications,
          );
          const quantity =
            args.quantity === undefined ? line.quantity : Number(args.quantity);
          if (
            current.cart.items.reduce((s, i) => s + i.quantity, 0) -
              line.quantity +
              quantity >
            current.job.maxCartItems
          )
            throw new DemoError(
              "CART_LIMIT",
              `Orders are limited to ${current.job.maxCartItems} items.`,
              409,
            );
          if (
            quantity === line.quantity &&
            stable(custom.selections) === stable(line.selections) &&
            stable([...custom.modifications].sort()) ===
              stable([...line.modifications].sort())
          )
            throw new DemoError(
              "CART_UNCHANGED",
              `This line already has quantity ${line.quantity} and those customizations. Nothing was changed. To remove this entire line, call remove_from_cart with its lineId. To reduce a multi-unit line, use a smaller positive quantity.`,
              409,
            );
          Object.assign(line, custom, { quantity });
        }
        changed();
        value = { cart: priceCart(state, current) };
      } else if (name === "set_order_details") {
        mutable();
        if (
          args.fulfillmentType &&
          !current.job.fulfillmentTypes.includes(
            args.fulfillmentType as "pickup" | "dine_in",
          )
        )
          throw new DemoError(
            "FULFILLMENT_DISABLED",
            "That fulfillment type is disabled.",
          );
        if (args.fulfillmentType)
          current.cart.fulfillmentType = args.fulfillmentType as
            | "pickup"
            | "dine_in";
        if (args.specialInstructions !== undefined)
          current.cart.specialInstructions = String(args.specialInstructions);
        changed();
        value = { cart: priceCart(state, current) };
      } else if (name === "calculate_order_total") {
        mutable();
        const cart = priceCart(state, current);
        if (!cart.items.length)
          throw new DemoError(
            "EMPTY_CART",
            "Add at least one product before reviewing an order.",
            409,
          );
        if (cart.issues.length)
          throw new DemoError("ORDER_INVALID", cart.issues.join(" "), 409);
        if (
          !current.quote ||
          current.quote.cartRevision !== current.cart.revision ||
          current.quote.menuRevision !== state.menuRevision ||
          Date.parse(current.quote.expiresAt) <= Date.now()
        ) {
          current.quote = {
            id: cashierId("quote"),
            cartRevision: current.cart.revision,
            menuRevision: state.menuRevision,
            jobVersion: current.job.version,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            cart,
          };
          delete current.approval;
        }
        current.status = "awaiting_confirmation";
        current.intent = "Waiting for customer confirmation";
        cashEvent(
          current,
          "review",
          "Exact order and total prepared for customer review",
          {
            quoteId: current.quote.id,
            totalMinor: cart.totalMinor,
            currency: cart.currency,
          },
          context.turnId,
        );
        const approved =
          current.approval?.quoteId === current.quote.id &&
          current.approval.turnId === context.turnId;
        value = {
          quote: current.quote,
          requiresCustomerConfirmation: !approved,
          customerApproval: approved
            ? "Already recorded for this exact quote and turn"
            : "Not recorded",
          nextStep: approved
            ? "The customer has already approved this unchanged quote. Call confirm_order with the displayed quote.id to persist it; do not ask for approval again."
            : "Show this exact quote and wait for explicit customer confirmation. This read has not placed an order.",
          paymentStatus: "unpaid",
        };
      } else if (name === "confirm_order") {
        if (current.orderId)
          value = {
            order: state.orders.find((o) => o.id === current.orderId),
            alreadyConfirmed: true,
          };
        else {
          mutable();
          const quote = current.quote;
          if (
            !quote ||
            quote.id !== args.quoteId ||
            quote.cartRevision !== current.cart.revision ||
            quote.menuRevision !== state.menuRevision ||
            Date.parse(quote.expiresAt) <= Date.now()
          )
            throw new DemoError(
              "CONFIRMATION_STALE",
              "The order or menu changed, or its review expired. Review the exact order again.",
              409,
            );
          if (
            current.approval?.quoteId !== quote.id ||
            current.approval.turnId !== context.turnId
          )
            throw new DemoError(
              "CUSTOMER_APPROVAL_REQUIRED",
              "The customer must explicitly confirm the displayed order. Use its Confirm order button or a standalone affirmative reply.",
              403,
            );
          const cart = priceCart(state, current);
          if (
            !cart.items.length ||
            cart.issues.length ||
            cart.totalMinor !== quote.cart.totalMinor
          )
            throw new DemoError(
              "ORDER_INVALID",
              cart.issues.join(" ") || "The order changed. Review it again.",
              409,
            );
          cashEvent(
            current,
            "order",
            "Products, options, availability, and final prices rechecked",
            { totalMinor: cart.totalMinor, menuRevision: state.menuRevision },
            context.turnId,
          );
          const at = cashierNow();
          const order = {
            id: cashierId("order"),
            number: `RB-${state.nextOrderNumber++}`,
            sessionId: current.id,
            createdAt: at,
            updatedAt: at,
            status: "new" as const,
            statusVersion: 1,
            cart,
            paymentStatus: "unpaid" as const,
            paymentArrangement: "pay_at_counter" as const,
          };
          state.orders.push(order);
          current.orderId = order.id;
          current.status = "confirmed";
          current.intent = "Order saved and sent to the local kitchen";
          delete current.approval;
          cashEvent(
            current,
            "order",
            "Confirmed order saved atomically",
            {
              orderId: order.id,
              number: order.number,
              paymentStatus: "unpaid",
            },
            context.turnId,
          );
          cashEvent(
            current,
            "kitchen",
            "Order added to the local kitchen queue",
            { orderId: order.id, status: "new" },
            context.turnId,
          );
          value = { order };
        }
      } else if (name === "get_order_status") {
        if (!current.orderId)
          throw new DemoError(
            "NO_CONFIRMED_ORDER",
            "This session has no confirmed order yet.",
            404,
          );
        current.intent = "Checking kitchen status";
        value = { order: state.orders.find((o) => o.id === current.orderId) };
      } else if (name === "request_human_handoff") {
        const existing = state.handoffs.find((h) => h.sessionId === current.id);
        const handoff = existing || {
          id: cashierId("handoff"),
          sessionId: current.id,
          at: cashierNow(),
          reason: String(args.reason),
          category: String(args.category),
        };
        if (!existing) state.handoffs.push(handoff);
        if (!current.orderId) current.status = "handoff";
        delete current.approval;
        delete current.quote;
        current.intent = "Staff help requested";
        cashEvent(
          current,
          "tool",
          "Local staff-help record saved",
          { handoff },
          context.turnId,
        );
        value = { handoff, notificationSent: false };
      }
      const success: ToolResult = { ok: true, value };
      const execution: ToolExecution = {
        id: cashierId("tool"),
        turnId: context.turnId,
        name,
        actor: context.actor,
        arguments: raw,
        result: success,
        status: "success",
        startedAt,
        completedAt: cashierNow(),
        key,
        argumentsHash,
      };
      current.tools.push(execution);
      cashEvent(
        current,
        "tool",
        `${name} completed`,
        { toolId: execution.id, actor: context.actor },
        context.turnId,
      );
      return success;
    });
    if (name === "confirm_order" && result.ok) {
      const savedSession = authorizeSession(context.sessionId, context.token);
      const order = verifyStoredOrder(savedSession.orderId!);
      cashierMutate((state) =>
        cashEvent(
          findSession(state, context.sessionId),
          "order",
          "Saved order verified by reading persisted storage",
          { orderId: order.id, number: order.number },
          context.turnId,
        ),
      );
      result = { ok: true, value: { order, verified: true } };
    }
  } catch (error) {
    const known = error instanceof DemoError;
    result = {
      ok: false,
      code: known ? error.code : "TOOL_FAILED",
      error: known
        ? error.message
        : "The backend could not save this operation. Review the cart and retry.",
    };
    // A persistence failure must not be represented as a successful action.
    try {
      cashierMutate((state) => {
        const current = findSession(state, context.sessionId);
        current.tools.push({
          id: cashierId("tool"),
          turnId: context.turnId,
          name,
          actor: context.actor,
          arguments: raw,
          result,
          status: "failure",
          startedAt,
          completedAt: cashierNow(),
          key,
          argumentsHash,
        });
        cashEvent(current, "error", `${name} failed`, result, context.turnId);
      });
    } catch {
      /* The original write failure is returned, without a fabricated result. */
    }
  }
  return result;
}
export function backendOrderReply(sessionId: string) {
  const state = cashierSnapshot();
  const session = findSession(state, sessionId);
  const order = state.orders.find((o) => o.id === session.orderId);
  if (!order) return null;
  return session.job.primaryLanguage === "tr"
    ? `${order.number} kaydedildi. Toplam: ${money(order.cart.totalMinor)}. Mutfak durumu: ${order.status}. Ödeme alınmadı; kasada ödeme yapın.`
    : `${order.number} is saved. Total: ${money(order.cart.totalMinor)}. Kitchen status: ${order.status}. Payment is still unpaid; pay at the counter.`;
}
