import { parseIntent } from "../ai/intent-parser";
import { generateFinalAssistantReply } from "../ai/response-generator.service";
import { addItemToCart, formatCart, getCartTotal, removeItemFromCart, type CartState } from "../cart/cart.service";
import { formatMenu, sushiMenu } from "../menu/sushi-menu";
import {
  getCartFromSession,
  getOrCreateActiveSession,
  getSessionContext,
  saveSessionContext,
  type SessionContext,
} from "../sessions/session.repository";
import { findOrCreateUserByWhatsappId } from "../users/user.repository";

type LocalSessionState = {
  cart: CartState;
  awaitingAddress: boolean;
  address: string | null;
};

const memorySessionStore = new Map<string, LocalSessionState>();
const OUT_OF_SCOPE_REPLY = "Claro 😊 puedo ayudarte con tu pedido, recomendaciones o resolver dudas del menú.";

function toLocalSessionState(context?: SessionContext): LocalSessionState {
  return {
    cart: context?.cart ?? { items: [] },
    awaitingAddress: context?.awaitingAddress ?? false,
    address: context?.address ?? null,
  };
}

function formatRecommendations(): string {
  const picks = sushiMenu.slice(0, 3);
  return ["Te recomiendo:", ...picks.map((item) => `${item.name} - $${item.price}`)].join("\n");
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
    state = {
      ...state,
      awaitingAddress: false,
      address: customerMessage.trim(),
    };
    await persistSessionState(whatsappUserId, state);
    return buildFinalReply({
      userMessage: customerMessage,
      intent: "checkout",
      actionSummary: `Address captured for checkout: ${state.address}`,
      state,
      extraContext: "The customer has provided the delivery address. Confirm it naturally and say payment is the next step.",
    });
  }

  const { intent, status } = await parseIntent(customerMessage);

  if (status === "missing_api_key") {
    return "⚠️ IA no configurada correctamente";
  }

  if (status === "openai_error" && intent.intent === "smalltalk") {
    return "Lo siento, tuve un problema procesando tu mensaje. ¿Podrias intentar de nuevo?";
  }

  switch (intent.intent) {
    case "show_menu":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: formatMenu(),
        state,
        extraContext: "Show the menu naturally and briefly invite the customer to order.",
      });

    case "show_cart":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: formatCart(state.cart),
        state,
        extraContext: "Summarize the cart naturally.",
      });

    case "recommend":
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: formatRecommendations(),
        state,
        extraContext: "Recommend a few menu items naturally.",
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
      };
      await persistSessionState(whatsappUserId, state);
      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: "Checkout started. Ask for the delivery address.",
        state,
        extraContext: "Ask directly for the delivery address.",
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
        return "Lo siento, tuve un problema procesando tu mensaje. ¿Podrias intentar de nuevo?";
      }

      return buildFinalReply({
        userMessage: customerMessage,
        intent: intent.intent,
        actionSummary: OUT_OF_SCOPE_REPLY,
        state,
        extraContext: "If the user is chatting or asking something outside the restaurant flow, reply politely and redirect to ordering help.",
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
