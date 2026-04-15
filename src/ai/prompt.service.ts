import { sushiMenu } from "../menu/sushi-menu";

function buildMenuContext(): string {
  return sushiMenu
    .map((item) => {
      const extras = item.extras.map((extra) => `${extra.name} (+$${extra.price})`).join(", ") || "none";
      const modifiers = item.modifiers.map((modifier) => modifier.name).join(", ") || "none";
      return `${item.name}: ${item.description ?? "No description"}. Extras: ${extras}. Modifiers: ${modifiers}.`;
    })
    .join("\n");
}

export function buildOrderingPrompt(customerMessage: string): string {
  return [
    "You are a WhatsApp ordering assistant for a sushi restaurant.",
    "Return only valid JSON.",
    'Always use this exact schema: {"action":"add_to_cart | remove_item | view_cart | show_menu | recommend | none","items":[{"name":"exact menu name","quantity":1,"extras":[],"modifiers":[]}],"index":null}.',
    "Rules:",
    "- Use product names, never IDs.",
    "- Match names exactly from the menu list.",
    "- Extras must match allowed extras for that menu item.",
    "- Modifiers must match allowed modifiers for that menu item.",
    "- Use index only when the customer refers to a cart position.",
    "- If the request is unclear, return action none and leave items empty.",
    "Menu:",
    buildMenuContext(),
    `Customer message: ${customerMessage}`,
  ].join("\n");
}
