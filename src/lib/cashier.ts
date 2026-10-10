export const defaultCashierModel = "qwen3.5:4b-q4_K_M";
export const categories = [
  "Burgers",
  "Chicken",
  "Combo Meals",
  "Sides",
  "Drinks",
  "Desserts",
] as const;
export const cashierTools = [
  "get_menu",
  "get_product_details",
  "check_product_availability",
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
  "get_cart",
  "calculate_order_total",
  "confirm_order",
  "get_order_status",
  "request_human_handoff",
  "set_order_details",
] as const;
export type CashierTool = (typeof cashierTools)[number];
export type Choice = {
  id: string;
  name: string;
  priceMinor: number;
  available: boolean;
};
export type OptionGroup = {
  id: string;
  name: string;
  required: boolean;
  defaultChoiceId?: string;
  choices: Choice[];
};
export type Modifier = { id: string; name: string; priceMinor: number };
export type MenuProduct = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  category: (typeof categories)[number];
  priceMinor: number;
  available: boolean;
  options: OptionGroup[];
  modifiers: Modifier[];
  ingredients: string[];
  allergens: string[];
};
export type Fulfillment = "pickup" | "dine_in";
export type CashierJob = {
  id: "fast-food-cashier";
  version: number;
  agentName: string;
  jobName: string;
  businessName: string;
  businessDescription: string;
  primaryLanguage: "en" | "tr";
  greeting: string;
  instructions: string;
  enabledTools: CashierTool[];
  currency: "USD";
  taxBasisPoints: number;
  maxCartItems: number;
  fulfillmentTypes: Fulfillment[];
};
export type CartItem = {
  id: string;
  productId: string;
  quantity: number;
  selections: Record<string, string>;
  modifications: string[];
};
export type Cart = {
  revision: number;
  items: CartItem[];
  fulfillmentType: Fulfillment;
  specialInstructions: string;
};
export type PricedItem = CartItem & {
  name: string;
  optionLabels: string[];
  modifierLabels: string[];
  unitMinor: number;
  subtotalMinor: number;
};
export type PricedCart = {
  items: PricedItem[];
  fulfillmentType: Fulfillment;
  specialInstructions: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: "USD";
  issues: string[];
  revision: number;
};
export type OrderQuote = {
  id: string;
  cartRevision: number;
  menuRevision: number;
  jobVersion: number;
  expiresAt: string;
  cart: PricedCart;
};
export const orderStatuses = [
  "new",
  "preparing",
  "ready",
  "completed",
] as const;
export type RestaurantOrder = {
  id: string;
  number: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: (typeof orderStatuses)[number];
  statusVersion: number;
  cart: PricedCart;
  paymentStatus: "unpaid";
  paymentArrangement: "pay_at_counter";
};
export type CashierEvent = {
  id: string;
  at: string;
  stage:
    | "received"
    | "model"
    | "tool"
    | "cart"
    | "review"
    | "order"
    | "kitchen"
    | "response"
    | "error"
    | "voice";
  label: string;
  turnId?: string;
  metadata: unknown;
};
export type ToolExecution = {
  id: string;
  turnId: string;
  name: string;
  actor: "model" | "customer" | "backend";
  arguments: unknown;
  result: unknown;
  status: "success" | "failure";
  startedAt: string;
  completedAt: string;
  key: string;
  argumentsHash: string;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  source: "text" | "voice" | "configuration" | "backend" | "model";
};
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id?: string;
    type?: "function";
    function: { name: string; arguments: Record<string, unknown> };
  }[];
  tool_name?: string;
  tool_call_id?: string;
};
export type CashierTurn = {
  id: string;
  requestId: string;
  text: string;
  source: "text" | "voice";
  status: "running" | "completed" | "failed" | "interrupted";
  messages: ModelMessage[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  reply?: string;
  approvedQuoteId?: string;
};
export type CashierSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  job: CashierJob;
  status: "draft" | "awaiting_confirmation" | "confirmed" | "handoff";
  processing: boolean;
  intent: string;
  cart: Cart;
  quote?: OrderQuote;
  approval?: { quoteId: string; turnId: string };
  orderId?: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  turns: CashierTurn[];
  events: CashierEvent[];
  tools: ToolExecution[];
};
export type CashierSessionView = CashierSession & {
  pricedCart: PricedCart;
  order?: RestaurantOrder;
  quoteValid: boolean;
};
export type Handoff = {
  id: string;
  sessionId: string;
  at: string;
  reason: string;
  category: string;
};
export type CashierOverview = {
  revision: number;
  menuRevision: number;
  job: CashierJob;
  products: MenuProduct[];
  orders: RestaurantOrder[];
  handoffs: Handoff[];
  sessions: {
    id: string;
    createdAt: string;
    status: CashierSession["status"];
    processing: boolean;
    orderId?: string;
    agentName: string;
  }[];
};
export type AgentHealth = {
  ready: boolean;
  provider: string;
  model: string;
  error?: string;
  setup?: string[];
};
export type Utterance = {
  id: string;
  sessionId: string;
  status: "queued" | "processing" | "completed" | "failed";
  text?: string;
  language?: string;
  duration?: number;
  model?: string;
  error?: { code: string; message: string };
};
export function money(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    minor / 100,
  );
}
