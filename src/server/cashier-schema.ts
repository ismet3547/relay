import { z } from "zod";
import { cashierTools, categories } from "../lib/cashier";

const id = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);
const label = z.string().trim().min(1).max(100);
const choice = z.strictObject({
  id,
  name: label,
  priceMinor: z.number().int().min(0).max(20000),
  available: z.boolean(),
});
const option = z
  .strictObject({
    id,
    name: label,
    required: z.boolean(),
    defaultChoiceId: id.optional(),
    choices: z.array(choice).min(1).max(12),
  })
  .superRefine((group, ctx) => {
    if (new Set(group.choices.map((c) => c.id)).size !== group.choices.length)
      ctx.addIssue({
        code: "custom",
        message: "Option choice IDs must be unique.",
      });
    if (
      group.defaultChoiceId &&
      !group.choices.some((c) => c.id === group.defaultChoiceId && c.available)
    )
      ctx.addIssue({
        code: "custom",
        message: "The default choice must be available in its group.",
      });
  });
export const productSchema = z
  .strictObject({
    id,
    name: label,
    aliases: z.array(z.string().trim().min(1).max(60)).max(10),
    description: z.string().trim().max(500),
    category: z.enum(categories),
    priceMinor: z.number().int().min(0).max(100000),
    available: z.boolean(),
    options: z.array(option).max(6),
    modifiers: z
      .array(
        z.strictObject({
          id,
          name: label,
          priceMinor: z.number().int().min(0).max(10000),
        }),
      )
      .max(12),
    ingredients: z.array(z.string().trim().min(1).max(60)).max(20),
    allergens: z.array(z.string().trim().min(1).max(60)).max(20),
  })
  .superRefine((product, ctx) => {
    for (const list of [product.options, product.modifiers])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        ctx.addIssue({
          code: "custom",
          message: "Option group and modifier IDs must be unique.",
        });
  });
export const jobSchema = z
  .strictObject({
    id: z.literal("fast-food-cashier"),
    version: z.number().int().min(1),
    agentName: label,
    jobName: label,
    businessName: label,
    businessDescription: z.string().trim().max(500),
    primaryLanguage: z.enum(["en", "tr"]),
    greeting: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(1).max(3000),
    enabledTools: z.array(z.enum(cashierTools)).min(2).max(cashierTools.length),
    currency: z.literal("USD"),
    taxBasisPoints: z.number().int().min(0).max(2500),
    maxCartItems: z.number().int().min(1).max(30),
    fulfillmentTypes: z
      .array(z.enum(["pickup", "dine_in"]))
      .min(1)
      .max(2),
  })
  .superRefine((job, ctx) => {
    if (
      !job.enabledTools.includes("get_menu") ||
      !job.enabledTools.includes("get_cart")
    )
      ctx.addIssue({
        code: "custom",
        message: "Menu and cart reads are required for this job.",
      });
    if (
      new Set(job.enabledTools).size !== job.enabledTools.length ||
      new Set(job.fulfillmentTypes).size !== job.fulfillmentTypes.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Tools and fulfillment types must be unique.",
      });
  });
export const menuWriteSchema = z
  .strictObject({
    revision: z.number().int().min(1),
    products: z.array(productSchema).min(1).max(100),
  })
  .superRefine((menu, ctx) => {
    if (new Set(menu.products.map((p) => p.id)).size !== menu.products.length)
      ctx.addIssue({ code: "custom", message: "Product IDs must be unique." });
  });
const selections = z.record(id, id);
const modifications = z.array(id).max(12);
export const toolSchemas = {
  get_menu: z.strictObject({
    category: z.enum(categories).optional(),
    search: z.string().max(100).optional(),
  }),
  get_product_details: z.strictObject({ productId: id }),
  check_product_availability: z.strictObject({ productId: id }),
  add_to_cart: z
    .strictObject({
      productId: id,
      quantity: z.number().int().min(1).max(10),
      selections: selections.optional(),
      modifications: modifications
        .optional()
        .describe(
          "For a single unit only. For quantity > 1 use unitCustomizations with explicit unit numbers.",
        ),
      unitCustomizations: z
        .array(
          z.strictObject({
            unit: z
              .number()
              .int()
              .min(1)
              .max(10)
              .describe(
                "1-based unit number within this addition: first=1, second=2, last=quantity.",
              ),
            selections: selections.optional(),
            modifications: modifications.optional(),
          }),
        )
        .max(10)
        .optional()
        .describe(
          "Overrides for specific units. Leave unmentioned units plain. For modifiers on every unit, include one entry per unit.",
        ),
    })
    .superRefine((args, ctx) => {
      if (args.quantity > 1 && args.modifications?.length)
        ctx.addIssue({
          code: "custom",
          message:
            "For quantity > 1, omit top-level modifications. Use unitCustomizations with explicit 1-based unit numbers for ONLY the intended units, or add plain units then update exact line IDs.",
        });
      const units = args.unitCustomizations?.map((c) => c.unit) || [];
      if (
        new Set(units).size !== units.length ||
        units.some((unit) => unit > args.quantity)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Each customized unit must be unique and between 1 and quantity.",
        });
    }),
  update_cart_item: z
    .strictObject({
      lineId: z.string().regex(/^line_[a-f0-9]{16}$/),
      quantity: z.number().int().min(1).max(10).optional(),
      selections: selections.optional(),
      modifications: modifications.optional(),
    })
    .refine(
      (x) =>
        x.quantity !== undefined ||
        x.selections !== undefined ||
        x.modifications !== undefined,
      "Include a quantity, selection, or modification change.",
    ),
  remove_from_cart: z.strictObject({
    lineId: z.string().regex(/^line_[a-f0-9]{16}$/),
  }),
  get_cart: z.strictObject({}),
  calculate_order_total: z.strictObject({}),
  confirm_order: z.strictObject({
    quoteId: z.string().regex(/^quote_[a-f0-9]{32}$/),
  }),
  get_order_status: z.strictObject({}),
  request_human_handoff: z.strictObject({
    category: z.enum([
      "refund",
      "payment_dispute",
      "allergen_question",
      "unsupported",
    ]),
    reason: z.string().trim().min(1).max(300),
  }),
  set_order_details: z
    .strictObject({
      fulfillmentType: z.enum(["pickup", "dine_in"]).optional(),
      specialInstructions: z.string().trim().max(300).optional(),
    })
    .refine(
      (x) =>
        x.fulfillmentType !== undefined || x.specialInstructions !== undefined,
      "Include an order detail to change.",
    ),
};
export const turnSchema = z.strictObject({
  text: z.string().trim().min(1).max(1500),
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  source: z.enum(["text", "voice"]).default("text"),
  utteranceId: z
    .string()
    .regex(/^utt_[a-f0-9]{32}$/)
    .optional(),
});
export const confirmationSchema = z.strictObject({
  quoteId: z.string().regex(/^quote_[a-f0-9]{32}$/),
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
});
export const kitchenSchema = z.strictObject({
  status: z.enum(["new", "preparing", "ready", "completed"]),
  version: z.number().int().min(1),
});
