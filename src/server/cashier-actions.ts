import { z } from "zod";
import { beginTurn, finishTurn, sessionView } from "./cashier-store";
import { executeCashierTool } from "./cashier-tools";

export const customerActionSchema = z.strictObject({
  name: z.enum([
    "remove_from_cart",
    "update_cart_item",
    "calculate_order_total",
    "set_order_details",
  ]),
  arguments: z.record(z.string(), z.unknown()),
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
});
export function customerAction(
  id: string,
  token: string,
  input: z.infer<typeof customerActionSchema>,
) {
  const text = `Customer used the cart control: ${input.name} ${JSON.stringify(input.arguments)}`;
  const started = beginTurn(id, token, text, input.messageId);
  if (!started.replayed) {
    const result = executeCashierTool(
      { sessionId: id, token, turnId: started.turnId, actor: "customer" },
      input.name,
      input.arguments,
    );
    const reply = result.ok
      ? input.name === "calculate_order_total"
        ? "Your exact order is ready to review. Confirm below to send it to the local kitchen. Payment is at the counter."
        : "Your cart change is saved. Review the updated items and total."
      : result.error;
    finishTurn(
      id,
      started.turnId,
      reply,
      result.ok ? undefined : result.error,
      "backend",
    );
  }
  return { session: sessionView(id), replayed: started.replayed };
}
