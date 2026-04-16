import { parseIntent } from "../ai/intent-parser";
import { generateFinalAssistantReply } from "../ai/response-generator.service";
import { addItemToCart, clearCart, getCartTotal, removeItemFromCart, type CartState } from "../cart/cart.service";
import { DeliveryService } from "../delivery/delivery.service";
import { getCartFromSession, getOrCreateActiveSession, getSessionContext, saveSessionContext, type SessionContext } from "../sessions/session.repository";
import { findOrCreateUserByWhatsappId } from "../users/user.repository";

type LocalSessionState = {
  cart: CartState;
  awaitingAddress: boolean;
  awaitingAddressConfirmation: boolean;
  address: string | null;
  deliveryFee: number | null;
  lastMentionedItem: string | null;
};

const memorySessionStore = new Map<string, LocalSessionState>();
const AI_MISSING_MESSAGE = "IA no configurada correctamente.";
const AI_FAILURE_MESSAGE = "Lo siento, tuve un problema procesando tu mensaje. Podrias intentar de nuevo?";
const deliveryService = new DeliveryService();

function isAddressQuery(text: string): boolean {
  const msg = text.toLowerCase();
  return (
    msg.includes("direccion") ||
    msg.includes("dirección") ||
    msg.includes("donde lo mandas") ||
    msg.includes("confirmar direccion") ||
    msg.includes("mi direccion")
  );
}

function isSavedAddressConfirmation(text: string): boolean {
  const msg = text.toLowerCase().trim();
  return msg === "si" || msg === "sí" || msg === "correcto" || msg === "esa" || msg === "ok" || msg === "usar esa";
}

function isAddressChangeRequest(text: string): boolean {
  const msg = text.toLowerCase().trim();
  return msg === "cambiar" || msg === "otra direccion" || msg === "otra dirección" || msg === "no";
}

function buildDeliverySummary(deliveryFee: number, etaMinutes: number, total: number): string {
  return [
    "Perfecto 👍 ya tengo tu dirección.",
    "",
    `🚚 Envío: $${deliveryFee}`,
    `⏱️ Tiempo estimado: ${etaMinutes} min`,
    `🧾 Total: $${total}`,
    "",
    "¿Deseas continuar con tu pedido?",
  ].join("\n");
}

function toLocalSessionState(context?: SessionContext): LocalSessionState {
  return {
    cart: context?.cart ?? { items: [] },
    awaitingAddress: context?.awaitingAddress ?? false,
    awaitingAddressConfirmation: context?.awaitingAddressConfirmation ?? false,
    address: context?.address ?? null,
    deliveryFee: context?.deliveryFee ?? null,
    lastMentionedItem: context?.lastMentionedItem ?? null,
  };
}

async function persistSessionState(whatsappUserId: string, state: LocalSessionState): Promise<void> {
  memorySessionStore.set(whatsappUserId, state);

  try {
    const user = await findOrCreateUserByWhatsappId(whatsappUserId);
    const session = await getOrCreateActiveSession(user.id);
    await saveSessionContext(session.id, {
      cart: state.cart,
      awaitingAddress: state.awaitingAddress,
      awaitingAddressConfirmation: state.awaitingAddressConfirmation,
      address: state.address,
      deliveryFee: state.deliveryFee,
      lastMentionedItem: state.lastMentionedItem,
    });
  } catch {
    // Keep the conversation working even if persistence is temporarily unavailable.
  }
}

async function getStoredSessionState(whatsappUserId: string): Promise<LocalSessionState> {
  const memoryState = memorySessionStore.get(whatsappUserId);
  if (memoryState) {
    return memoryState;
  }

  try {
    const user = await findOrCreateUserByWhatsappId(whatsappUserId);
    const session = await getOrCreateActiveSession(user.id);
    const state = toLocalSessionState({
      ...getSessionContext(session),
      cart: getCartFromSession(session),
    });
    memorySessionStore.set(whatsappUserId, state);
    return state;
  } catch {
    return toLocalSessionState();
  }
}

async function buildFinalReply(input: {
  userMessage: string;
  intent: string;
  actionSummary: string;
  state: LocalSessionState;
  extraContext?: string;
}): Promise<string> {
  return generateFinalAssistantReply({
    userMessage: input.userMessage,
    intent: input.intent,
    actionSummary: input.actionSummary,
    cart: input.state.cart,
    extraContext: input.extraContext,
  });
}

export async function handleOrderingMessage(whatsappUserId: string, customerMessage: string): Promise<string> {
  let state = await getStoredSessionState(whatsappUserId);

  if (state.awaitingAddressConfirmation && state.address) {
    if (isSavedAddressConfirmation(customerMessage)) {
      const quote = deliveryService.getQuote(state.address);
      const cartTotal = getCartTotal(state.cart);
      const total = cartTotal + quote.fee;

      state = {
        ...state,
        awaitingAddressConfirmation: false,
        deliveryFee: quote.fee,
      };
      await persistSessionState(whatsappUserId, state);
      return buildDeliverySummary(quote.fee, quote.etaMinutes, total);
    }

    if (isAddressChangeRequest(customerMessage)) {
      state = {
        ...state,
        awaitingAddressConfirmation: false,
        awaitingAddress: true,
        deliveryFee: null,
      };
      await persistSessionState(whatsappUserId, state);
      return "Claro, compárteme la nueva dirección y actualizo tu envío.";
    }
  }

  if (state.awaitingAddress) {
    const address = customerMessage.trim();
    const quote = deliveryService.getQuote(address);
    const cartTotal = getCartTotal(state.cart);
    const total = cartTotal + quote.fee;

    state = {
      ...state,
      awaitingAddress: false,
      awaitingAddressConfirmation: false,
      address,
      deliveryFee: quote.fee,
    };
    await persistSessionState(whatsappUserId, state);
    return buildDeliverySummary(quote.fee, quote.etaMinutes, total);
  }

  if (isAddressQuery(customerMessage)) {
    if (state.address) {
      return `📍 Esta es la dirección que tengo registrada:\n${state.address}\n\n¿Deseas usar esta dirección para tu pedido?`;
    }

    return "Aún no tengo una dirección registrada. ¿Me la puedes compartir por favor?";
  }

  const { intent, status } = await parseIntent(customerMessage, {
    lastMentionedItem: state.lastMentionedItem,
  });

  if (intent.items.length > 0) {
    state = {
      ...state,
      lastMentionedItem: intent.items[0]?.name ?? state.lastMentionedItem,
    };
    await persistSessionState(whatsappUserId, state);
  }

  if (status === "missing_api_key") {
    return AI_MISSING_MESSAGE;
  }

  if (status === "openai_error" && intent.intent === "unknown") {
    return AI_FAILURE_MESSAGE;
  }

  switch (intent.intent) {
    case "show_menu":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "The customer asked to see the menu.",
        state,
        extraContext: "Show the full menu naturally, using the provided menu context, and briefly invite the customer to order.",
      });

    case "view_cart":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "The customer asked to see the current cart.",
        state,
        extraContext: "Summarize the current cart naturally using the provided cart context.",
      });

    case "clear_cart":
      state = {
        ...state,
        cart: clearCart(),
        deliveryFee: null,
      };
      await persistSessionState(whatsappUserId, state);
      return "Listo 🧹 tu carrito quedó vacío";

    case "recommend":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "The customer wants a recommendation.",
        state,
        extraContext: "Recommend 2 or 3 items naturally from the menu context. Do not use a fixed template. Briefly explain why they fit.",
      });

    case "checkout":
      if (state.cart.items.length === 0) {
        return "No tienes productos en tu carrito aún 😅 ¿Te gustaría ver el menú?";
      }

      state = {
        ...state,
        awaitingAddress: false,
        awaitingAddressConfirmation: false,
        deliveryFee: null,
      };

      if (state.address) {
        state = {
          ...state,
          awaitingAddressConfirmation: true,
        };
        await persistSessionState(whatsappUserId, state);
        return `📍 Tengo esta dirección registrada:\n${state.address}\n\n¿Quieres usar esta dirección o prefieres cambiarla?`;
      }

      state = {
        ...state,
        awaitingAddress: true,
      };
      await persistSessionState(whatsappUserId, state);
      return "Perfecto 👍 para continuar con tu pedido, ¿me puedes compartir tu dirección de entrega?";

    case "add_to_cart": {
      if (intent.items.length === 0) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "No valid product was identified from the request.",
          state,
          extraContext: "Ask the customer which item they want from the menu.",
        });
      }

      const addedLines: string[] = [];
      let nextCart = state.cart;

      for (const item of intent.items) {
        const result = addItemToCart(nextCart, {
          name: item.name,
          quantity: item.quantity,
          extras: item.extras,
          modifiers: item.removals,
        });

        nextCart = result.cart;

        if (result.addedItem) {
          addedLines.push(`- ${result.addedItem.name} x${item.quantity}`);
        }
      }

      if (addedLines.length === 0) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "No requested products were found in the menu.",
          state,
          extraContext: "Politely say the product was not found and guide the user toward the menu.",
        });
      }

      state = {
        ...state,
        cart: nextCart,
        lastMentionedItem: intent.items[0]?.name ?? state.lastMentionedItem,
      };
      await persistSessionState(whatsappUserId, state);
      return ["Agregué:", ...addedLines].join("\n");
    }

    case "remove_item": {
      if (intent.items.length === 0) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "No valid product was identified to remove.",
          state,
          extraContext: "Ask the customer which item should be removed from the cart.",
        });
      }

      const removedLines: string[] = [];
      let nextCart = state.cart;

      for (const item of intent.items) {
        const result = removeItemFromCart(nextCart, { name: item.name });
        nextCart = result.cart;
        if (result.removedItem) {
          removedLines.push(`- ${result.removedItem.name}`);
        }
      }

      if (removedLines.length === 0) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "The requested products were not found in the cart.",
          state,
          extraContext: "Politely say the product was not found in the cart.",
        });
      }

      state = {
        ...state,
        cart: nextCart,
        lastMentionedItem: intent.items[0]?.name ?? state.lastMentionedItem,
      };
      await persistSessionState(whatsappUserId, state);
      return ["Quité:", ...removedLines].join("\n");
    }

    case "unknown":
    default:
      if (status === "openai_error") {
        return AI_FAILURE_MESSAGE;
      }

      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "No restaurant action was executed.",
        state,
        extraContext: "Reply naturally. If the user is chatting, engage briefly and helpfully. If they are outside the restaurant flow, gently redirect them toward menu help, recommendations, cart, or checkout.",
      });
  }
}

export async function getStoredCart(whatsappUserId: string): Promise<CartState> {
  const state = await getStoredSessionState(whatsappUserId);
  return state.cart;
}

export function getCartSummaryTotal(cart: CartState): number {
  return getCartTotal(cart);
}
