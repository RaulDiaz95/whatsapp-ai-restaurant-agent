import type { CartState } from "../cart/cart.service";
import { formatCart } from "../cart/cart.service";
import { formatMenu, sushiMenu } from "../menu/sushi-menu";

function formatMenuContext(): string {
  return sushiMenu
    .map((item) => {
      const extras = item.extras.map((extra) => `${extra.name} (+$${extra.price})`).join(", ") || "none";
      const modifiers = item.modifiers.map((modifier) => modifier.name).join(", ") || "none";
      return `${item.name}: ${item.description ?? "No description"}. Extras: ${extras}. Remove ingredients/modifiers: ${modifiers}.`;
    })
    .join("\n");
}

export function buildIntentPrompt(): string {
  return [
    "You are an intent parser for a WhatsApp sushi restaurant assistant.",
    "Understand both Spanish and English.",
    "Return only valid JSON.",
    'Use exactly this schema: {"intent":"add_to_cart | remove_item | show_menu | show_cart | recommend | checkout | smalltalk","product":string|null,"quantity":number|null,"extras":string[],"removeIngredients":string[]}.',
    "Rules:",
    "- If the user is chatting, greeting, asking broad questions, or talking outside the order flow, return intent smalltalk.",
    "- For add_to_cart and remove_item, identify the product name from the menu when possible.",
    "- Extras must match available extras from the menu.",
    "- removeIngredients should contain things like sin arroz or no rice requests.",
    "- quantity should be null if not specified.",
    "- Keep product null when no product is clearly requested.",
    "Menu:",
    formatMenuContext(),
  ].join("\n");
}

export function buildFinalResponsePrompt(input: {
  userMessage: string;
  intent: string;
  actionSummary: string;
  cart: CartState;
  extraContext?: string;
}): string {
  return [
    "You are a real restaurant assistant replying on WhatsApp.",
    "You sound warm, natural, short, and helpful.",
    "You can reply in Spanish or English based on the user.",
    "Do not sound robotic.",
    "Do not invent products, prices, or cart contents.",
    "Use only the facts provided below.",
    'If the message is outside the restaurant context, reply politely: "Claro 😊 puedo ayudarte con tu pedido, recomendaciones o resolver dudas del menú."',
    `User message: ${input.userMessage}`,
    `Detected intent: ${input.intent}`,
    `Action result: ${input.actionSummary}`,
    `Current cart: ${formatCart(input.cart)}`,
    `Menu context:\n${formatMenu()}`,
    input.extraContext ? `Extra context: ${input.extraContext}` : "",
    "Return only the final WhatsApp reply text.",
  ]
    .filter(Boolean)
    .join("\n");
}
