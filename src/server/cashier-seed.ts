import {
  CashierJob,
  cashierTools,
  MenuProduct,
  Modifier,
  OptionGroup,
} from "../lib/cashier";

const size = (defaultChoiceId?: string): OptionGroup => ({
  id: "size",
  name: "Size",
  required: true,
  ...(defaultChoiceId ? { defaultChoiceId } : {}),
  choices: [
    { id: "small", name: "Small", priceMinor: 0, available: true },
    { id: "medium", name: "Medium", priceMinor: 100, available: true },
    { id: "large", name: "Large", priceMinor: 200, available: true },
  ],
});
const burgerModifiers: Modifier[] = [
  { id: "no_pickles", name: "No pickles", priceMinor: 0 },
  { id: "no_onions", name: "No onions", priceMinor: 0 },
  { id: "no_sauce", name: "No sauce", priceMinor: 0 },
  { id: "extra_cheese", name: "Extra cheese", priceMinor: 75 },
  { id: "extra_sauce", name: "Extra sauce", priceMinor: 50 },
];
const drink: OptionGroup = {
  id: "drink",
  name: "Meal drink",
  required: true,
  choices: [
    { id: "cola", name: "Cola", priceMinor: 0, available: true },
    { id: "sprite", name: "Sprite", priceMinor: 0, available: true },
    { id: "water", name: "Water", priceMinor: 0, available: true },
    {
      id: "milkshake",
      name: "Vanilla milkshake",
      priceMinor: 199,
      available: true,
    },
  ],
};
function product(
  id: string,
  name: string,
  category: MenuProduct["category"],
  priceMinor: number,
  details: Partial<MenuProduct> = {},
): MenuProduct {
  return {
    id,
    name,
    category,
    priceMinor,
    aliases: [],
    description: "Prepared to order at Relay Burger.",
    available: true,
    options: [],
    modifiers: [],
    ingredients: [],
    allergens: [],
    ...details,
  };
}
export function seedCashier() {
  const job: CashierJob = {
    id: "fast-food-cashier",
    version: 1,
    agentName: "Alex",
    jobName: "Fast-Food Cashier",
    businessName: "Relay Burger",
    businessDescription:
      "A fictional neighborhood fast-food restaurant. Orders are prepared locally and paid at the counter.",
    primaryLanguage: "en",
    greeting:
      "Hi, I'm Alex. Welcome to Relay Burger! What can I get started for you?",
    instructions:
      "Be friendly, concise, and professional. Help customers browse the actual menu, choose meal sizes and drinks, customize items, and review their order. Ask a question when a request is ambiguous. Never silently substitute a product. Do not guarantee allergen safety; refer uncertain questions to staff.",
    enabledTools: [...cashierTools],
    currency: "USD",
    taxBasisPoints: 825,
    maxCartItems: 30,
    fulfillmentTypes: ["pickup", "dine_in"],
  };
  const products: MenuProduct[] = [
    product("classic_burger", "Classic Burger", "Burgers", 545, {
      aliases: ["burger", "burgers", "hamburger", "hamburgers"],
      description: "Beef patty with pickles, onions, and house sauce.",
      modifiers: burgerModifiers.filter((m) => m.id !== "extra_cheese"),
      ingredients: ["beef", "wheat bun", "pickles", "onions", "house sauce"],
      allergens: ["wheat", "egg"],
    }),
    product("cheeseburger", "Cheeseburger", "Burgers", 595, {
      aliases: ["cheese burger"],
      description:
        "Beef patty, cheddar, pickles, onions, and house sauce in a toasted bun.",
      modifiers: burgerModifiers,
      ingredients: [
        "beef",
        "cheddar",
        "wheat bun",
        "pickles",
        "onions",
        "house sauce",
      ],
      allergens: ["milk", "wheat", "egg"],
    }),
    product("double_cheeseburger", "Double Cheeseburger", "Burgers", 795, {
      description: "Two beef patties and two slices of cheddar.",
      modifiers: burgerModifiers,
      ingredients: [
        "beef",
        "cheddar",
        "wheat bun",
        "pickles",
        "onions",
        "house sauce",
      ],
      allergens: ["milk", "wheat", "egg"],
    }),
    product("chicken_burger", "Chicken Burger", "Chicken", 695, {
      description: "Crispy chicken with lettuce and house sauce.",
      modifiers: [
        { id: "no_sauce", name: "No sauce", priceMinor: 0 },
        { id: "extra_cheese", name: "Extra cheese", priceMinor: 75 },
        { id: "extra_sauce", name: "Extra sauce", priceMinor: 50 },
      ],
      ingredients: ["chicken", "wheat bun", "lettuce", "house sauce"],
      allergens: ["wheat", "egg", "milk"],
    }),
    product("classic_burger_meal", "Classic Burger Meal", "Combo Meals", 1095, {
      aliases: ["burger meal", "burger combo"],
      description:
        "Classic burger, fries, and your selected drink. Choose meal size and drink.",
      options: [size(), drink],
      modifiers: burgerModifiers,
      ingredients: [
        "beef",
        "wheat bun",
        "potatoes",
        "pickles",
        "onions",
        "house sauce",
      ],
      allergens: ["wheat", "egg", "milk"],
    }),
    product("chicken_meal", "Chicken Meal", "Combo Meals", 1195, {
      description: "Chicken burger, fries, and your selected drink.",
      options: [size(), drink],
      modifiers: [
        { id: "no_sauce", name: "No sauce", priceMinor: 0 },
        { id: "extra_cheese", name: "Extra cheese", priceMinor: 75 },
      ],
      ingredients: ["chicken", "wheat bun", "potatoes", "house sauce"],
      allergens: ["wheat", "egg", "milk"],
    }),
    product("fries", "French Fries", "Sides", 299, {
      aliases: ["fries"],
      options: [size("medium")],
      ingredients: ["potatoes", "vegetable oil", "salt"],
    }),
    product("chicken_nuggets", "Chicken Nuggets", "Chicken", 499, {
      aliases: ["nuggets"],
      options: [
        {
          id: "pieces",
          name: "Portion",
          required: true,
          defaultChoiceId: "six",
          choices: [
            { id: "six", name: "6 pieces", priceMinor: 0, available: true },
            { id: "nine", name: "9 pieces", priceMinor: 200, available: true },
          ],
        },
      ],
      modifiers: [
        { id: "extra_sauce", name: "Extra dipping sauce", priceMinor: 50 },
      ],
      ingredients: ["chicken", "wheat coating"],
      allergens: ["wheat", "egg"],
    }),
    product("cola", "Cola", "Drinks", 199, {
      aliases: ["coke", "coca cola"],
      options: [size("medium")],
      ingredients: ["carbonated water", "sugar"],
    }),
    product("sprite", "Sprite", "Drinks", 199, {
      aliases: ["lemon lime soda"],
      options: [size("medium")],
      ingredients: ["carbonated water", "sugar", "lemon-lime flavor"],
    }),
    product("water", "Water", "Drinks", 149, {
      description: "Still bottled water.",
      ingredients: ["water"],
    }),
    product("milkshake", "Milkshake", "Drinks", 349, {
      options: [
        {
          id: "flavor",
          name: "Flavor",
          required: true,
          choices: [
            { id: "vanilla", name: "Vanilla", priceMinor: 0, available: true },
            {
              id: "chocolate",
              name: "Chocolate",
              priceMinor: 0,
              available: true,
            },
          ],
        },
      ],
      ingredients: ["milk", "ice cream"],
      allergens: ["milk"],
    }),
    product("strawberry_shake", "Strawberry Shake", "Drinks", 399, {
      available: false,
      description: "Currently sold out.",
      ingredients: ["milk", "strawberries"],
      allergens: ["milk"],
    }),
    product("brownie", "Chocolate Brownie", "Desserts", 299, {
      ingredients: ["cocoa", "wheat flour", "butter", "egg"],
      allergens: ["wheat", "milk", "egg"],
    }),
    product("soft_serve", "Vanilla Soft Serve", "Desserts", 249, {
      aliases: ["ice cream"],
      ingredients: ["milk", "vanilla"],
      allergens: ["milk"],
    }),
  ];
  return {
    version: 1 as const,
    revision: 1,
    menuRevision: 1,
    nextOrderNumber: 1001,
    job,
    products,
    sessions: [] as never[],
    orders: [] as never[],
    handoffs: [] as never[],
  };
}
