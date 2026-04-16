import { parseIntent } from "../ai/intent-parser";
import { addItemToCart, formatCart, getCartTotal, removeItemFromCart, type CartState } from "../cart/cart.service";
import { formatMenu, sushiMenu } from "../menu/sushi-menu";
import { getCartFromSession, getOrCreateActiveSession, saveCartToSession } from "../sessions/session.repository";
import { findOrCreateUserByWhatsappId } from "../users/user.repository";

const memoryCartStore = new Map<string, CartState>();
const AI_ERROR_MESSAGE = "Lo siento, tuve un problema procesando tu mensaje. ¿Podrias intentar de nuevo?";
const AI_MISSING_MESSAGE = "⚠️ IA no configurada correctamente";

function formatAddedItemMessage(item: {
  name: string;
  quantity: number;
  extras: Array<{ name: string; price: number }>;
  modifiers: string[];
}): string {
  const details: string[] = [`Agregue ${item.quantity} x ${item.name}`];

  if (item.extras.length > 0) {
    details.push(`con ${item.extras.map((extra) => extra.name).join(", ")}`);
  }

  if (item.modifiers.length > 0) {
    details.push(item.modifiers.join(", "));
  }

  return details.join(" ");
}

function formatRecommendations(): string {
  const picks = sushiMenu.slice(0, 3);
  return [
    "Te recomiendo:",
    ...picks.map((item) => `- ${item.name} - $${item.price}`),
  ].join("\n");
}

async function persistCart(whatsappUserId: string, cart: CartState): Promise<void> {
  memoryCartStore.set(whatsappUserId, cart);

  try {
    const user = await findOrCreateUserByWhatsappId(whatsappUserId);
    const session = await getOrCreateActiveSession(user.id);
    await saveCartToSession(session.id, cart);
  } catch {
    // Keep the conversation working even if persistence is temporarily unavailable.
  }
}

export async function getStoredCart(whatsappUserId: string): Promise<CartState> {
  const memoryCart = memoryCartStore.get(whatsappUserId);
  if (memoryCart) {
    return memoryCart;
  }

  try {
    const user = await findOrCreateUserByWhatsappId(whatsappUserId);
    const session = await getOrCreateActiveSession(user.id);
    const cart = getCartFromSession(session);
    memoryCartStore.set(whatsappUserId, cart);
    return cart;
  } catch {
    return { items: [] };
  }
}

export async function handleOrderingMessage(whatsappUserId: string, customerMessage: string): Promise<string> {
  const { intent, status } = await parseIntent(customerMessage);
  let cart = await getStoredCart(whatsappUserId);

  switch (intent.action) {
    case "show_menu":
      return formatMenu();

    case "view_cart":
      return formatCart(cart);

    case "recommend":
      return formatRecommendations();

    case "add_to_cart": {
      if (intent.items.length === 0) {
        return "No entendi que producto quieres agregar. Puedes decirme el nombre del rollo.";
      }

      const addedSummaries: string[] = [];

      for (const item of intent.items) {
        const result = addItemToCart(cart, item);
        cart = result.cart;

        if (result.addedItem) {
          addedSummaries.push(formatAddedItemMessage(result.addedItem));
        }
      }

      if (addedSummaries.length === 0) {
        return "No encontre ese producto en el menu. Escribe menu y te lo muestro completo.";
      }

      await persistCart(whatsappUserId, cart);
      return `${addedSummaries.join("\n")}\n\n${formatCart(cart)}`;
    }

    case "remove_item": {
      const removalTargets = intent.items.length > 0 ? intent.items : [{ name: "", quantity: 1, extras: [], modifiers: [] }];
      let removedNames: string[] = [];

      if (intent.index !== null) {
        const result = removeItemFromCart(cart, { index: intent.index });
        cart = result.cart;
        if (result.removedItem) {
          removedNames = [result.removedItem.name];
        }
      } else {
        for (const item of removalTargets) {
          const result = removeItemFromCart(cart, { name: item.name });
          cart = result.cart;
          if (result.removedItem) {
            removedNames.push(result.removedItem.name);
          }
        }
      }

      if (removedNames.length === 0) {
        return "No encontre ese producto en tu carrito.";
      }

      await persistCart(whatsappUserId, cart);
      return `Elimine: ${removedNames.join(", ")}\n\n${formatCart(cart)}`;
    }

    case "none":
    default:
      if (status === "missing_api_key") {
        return AI_MISSING_MESSAGE;
      }

      if (status === "openai_error") {
        return AI_ERROR_MESSAGE;
      }

      return AI_ERROR_MESSAGE;
  }
}

export function getCartSummaryTotal(cart: CartState): number {
  return getCartTotal(cart);
}
