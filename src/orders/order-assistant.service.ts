import { parseIntent } from "../ai/intent-parser";
import { generateFinalAssistantReply } from "../ai/response-generator.service";
import { addItemToCart, getCartTotal, removeItemFromCart, type CartState } from "../cart/cart.service";
import { DeliveryService } from "../delivery/delivery.service";
import { getCartFromSession, getOrCreateActiveSession, getSessionContext, saveSessionContext, type SessionContext } from "../sessions/session.repository";
import { findOrCreateUserByWhatsappId } from "../users/user.repository";

type LocalSessionState = {
  cart: CartState;
  awaitingAddress: boolean;
  address: string | null;
  deliveryFee: number | null;
};

const memorySessionStore = new Map<string, LocalSessionState>();
const AI_MISSING_MESSAGE = "IA no configurada correctamente.";
const AI_FAILURE_MESSAGE = "Lo siento, tuve un problema procesando tu mensaje. Podrias intentar de nuevo?";
const deliveryService = new DeliveryService();

function toLocalSessionState(context?: SessionContext): LocalSessionState {
  return {
    cart: context?.cart ?? { items: [] },
    awaitingAddress: context?.awaitingAddress ?? false,
    address: context?.address ?? null,
    deliveryFee: context?.deliveryFee ?? null,
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
      address: state.address,
      deliveryFee: state.deliveryFee,
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

  if (state.awaitingAddress) {
    const address = customerMessage.trim();
    const quote = deliveryService.getQuote(address);
    const cartTotal = getCartTotal(state.cart);
    const total = cartTotal + quote.fee;

    state = {
      ...state,
      awaitingAddress: false,
      address,
      deliveryFee: quote.fee,
    };
    await persistSessionState(whatsappUserId, state);
    return [
      "Perfecto 👍 ya tengo tu dirección.",
      "",
      `🚚 Envío: $${quote.fee}`,
      `⏱️ Tiempo estimado: ${quote.etaMinutes} min`,
      `🧾 Total: $${total}`,
      "",
      "¿Deseas continuar con tu pedido?",
    ].join("\n");
  }

  const { intent, status } = await parseIntent(customerMessage);

  if (status === "missing_api_key") {
    return AI_MISSING_MESSAGE;
  }

  if (status === "openai_error" && intent.intent === "smalltalk") {
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

    case "show_cart":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "The customer asked to see the current cart.",
        state,
        extraContext: "Summarize the current cart naturally using the provided cart context.",
      });

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
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "The cart is empty, so checkout cannot start yet.",
          state,
          extraContext: "Politely say the cart is empty and invite the customer to order first.",
        });
      }

      state = {
        ...state,
        awaitingAddress: true,
        deliveryFee: null,
      };
      await persistSessionState(whatsappUserId, state);
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "Checkout started. Ask for the delivery address.",
        state,
        extraContext: "Ask directly for the delivery address in a natural way.",
      });

    case "add_to_cart": {
      if (!intent.product) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "No valid product was identified from the request.",
          state,
          extraContext: "Ask the customer which item they want from the menu.",
        });
      }

      const result = addItemToCart(state.cart, {
        name: intent.product,
        quantity: intent.quantity ?? 1,
        extras: intent.extras,
        modifiers: intent.removeIngredients,
      });

      if (!result.addedItem) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: `The requested product was not found: ${intent.product}`,
          state,
          extraContext: "Politely say the product was not found and guide the user toward the menu.",
        });
      }

      state = {
        ...state,
        cart: result.cart,
      };
      await persistSessionState(whatsappUserId, state);

      const extrasText = result.addedItem.extras.length > 0 ? ` Extras: ${result.addedItem.extras.map((extra) => extra.name).join(", ")}.` : "";
      const modifiersText = result.addedItem.modifiers.length > 0 ? ` Remove ingredients: ${result.addedItem.modifiers.join(", ")}.` : "";

      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: `Added ${result.addedItem.quantity} x ${result.addedItem.name} to the cart.${extrasText}${modifiersText} Cart total: $${getCartTotal(state.cart)}.`,
        state,
        extraContext: "Confirm the add-to-cart action naturally and mention the current total if helpful.",
      });
    }

    case "remove_item": {
      if (!intent.product) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: "No valid product was identified to remove.",
          state,
          extraContext: "Ask the customer which item should be removed from the cart.",
        });
      }

      const result = removeItemFromCart(state.cart, { name: intent.product });

      if (!result.removedItem) {
        return buildFinalReply({
          userMessage: customerMessage,
          intent: intent.intent,
          actionSummary: `The requested product was not found in the cart: ${intent.product}`,
          state,
          extraContext: "Politely say the product was not found in the cart.",
        });
      }

      state = {
        ...state,
        cart: result.cart,
      };
      await persistSessionState(whatsappUserId, state);
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: `Removed ${result.removedItem.name} from the cart. Cart total: $${getCartTotal(state.cart)}.`,
        state,
        extraContext: "Confirm the remove action naturally.",
      });
    }

    case "smalltalk":
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
