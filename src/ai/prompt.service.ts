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
    "You are an assistant for a sushi restaurant.",
    "You must ALWAYS return a JSON response.",
    "Return only valid JSON, no extra text.",
    'Use exactly this schema: {"intent":"string","items":[{"name":"string","quantity":1,"extras":[],"removals":[]}],"message":"string"}',
    "Valid intents:",
    '- "add_to_cart"',
    '- "remove_item"',
    '- "clear_cart"',
    '- "view_cart"',
    '- "show_menu"',
    '- "checkout"',
    '- "unknown"',
    "Rules:",
    '- If user says "elimina todo", "limpiar carrito", or "borra todo", intent = "clear_cart".',
    '- If user says "quiero pagar", "proceder al pago", "quiero proceder", "terminar pedido", "finalizar", "ya es todo", "listo", or "cerrar pedido", intent = "checkout".',
    "- If the user orders multiple items in one message, return all of them in items.",
    "- Always extract quantity.",
    "- If no quantity is specified, default quantity to 1.",
    "- Extras must match available extras from the menu.",
    "- Removals must contain things like sin arroz or no rice requests.",
    "- message must be natural, friendly and short.",
    "- Use the menu reference internally.",
    "Menu reference:",
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
    "You are the main conversational brain for the restaurant.",
    "You sound warm, natural, short, helpful, and human.",
    "You can reply in Spanish or English based on the user.",
    "Do not sound robotic or scripted.",
    "Vary your phrasing and avoid repeating the same opening or closing sentences.",
    "Do not invent products, prices, or cart contents.",
    "Use only the facts provided below.",
    "If the user is chatting, answer naturally.",
    "If the user is outside the restaurant context, reply politely and guide them back to menu help, recommendations, cart, or checkout.",
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
