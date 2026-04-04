import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sushiMenu } from "../lib/sushiMenu";
import { requireEnv } from "../src/utils/env";

type SushiExtra = {
  name: string;
  price: number;
};

type SushiMenuItem = (typeof sushiMenu)[number] & {
  extras?: SushiExtra[];
  modifiers?: string[];
};

type CartItem = {
  id: string;
  name: string;
  basePrice: number;
  quantity: number;
  extras: SushiExtra[];
  modifiers: string[];
};

type ParsedSelection = {
  itemIndex: number;
  quantity: number;
  extras: string[];
  modifiers: string[];
};

type IntentItem = {
  id?: number | string;
  quantity?: number;
};

type IntentResult =
  | {
      action: "show_menu";
    }
  | {
      action: "add_to_cart";
      items: IntentItem[];
    }
  | {
      action: "view_cart";
    }
  | {
      action: "remove_item";
      items: IntentItem[];
    }
  | {
      action: "recommend";
    }
  | {
      action: "none";
    };

type CartEditCommand =
  | {
      type: "remove";
      itemIndex: number;
    }
  | {
      type: "update";
      itemIndex: number;
      quantity: number;
    }
  | {
      type: "clear";
    };

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const OPENAI_MODEL = "gpt-4o-mini";
const MAX_HISTORY_MESSAGES = 10;
const carts: Record<string, CartItem[]> = {};
const conversationHistory: Record<string, ConversationMessage[]> = {};
const NATURAL_FALLBACK_MESSAGE = "Se me fue esa parte, pero si quieres te ayudo con tu pedido. Te muestro el menu o te recomiendo algo.";

function getQueryParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getVerifyToken(): string {
  return requireEnv("WHATSAPP_VERIFY_TOKEN").WHATSAPP_VERIFY_TOKEN;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getConversationHistory(userId: string): ConversationMessage[] {
  return conversationHistory[userId] || [];
}

function saveConversationTurn(userId: string, userMessage: string, assistantMessage: string): void {
  const currentHistory = getConversationHistory(userId);
  const newEntries: ConversationMessage[] = [
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantMessage },
  ];
  const updatedHistory = [...currentHistory, ...newEntries];
  conversationHistory[userId] = updatedHistory.slice(-MAX_HISTORY_MESSAGES);
}

function formatMenu(menu: typeof sushiMenu): string {
  const items = menu.map((item, index) => `${index + 1}. ${item.name} - $${item.price}`);
  return ["MENU SUSHI", "", ...items].join("\n");
}

function formatRecommendations(menu: typeof sushiMenu): string {
  const suggestions = [menu[4], menu[0], menu[2]].filter((item): item is (typeof sushiMenu)[number] => Boolean(item));
  const lines = ["Te recomiendo estos rolls:", ""];

  suggestions.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name} - $${item.price}`);
  });

  lines.push("", "Si quieres, te los agrego.");
  return lines.join("\n");
}

function getUnitPrice(item: CartItem): number {
  const extrasTotal = item.extras.reduce((sum, extra) => sum + extra.price, 0);
  return item.basePrice + extrasTotal;
}

function formatCart(cart: CartItem[]): string {
  const lines: string[] = ["TU CARRITO", ""];
  let total = 0;

  cart.forEach((item, index) => {
    const unitPrice = getUnitPrice(item);
    const lineTotal = unitPrice * item.quantity;
    total += lineTotal;

    lines.push(`${index + 1}. ${item.name} x${item.quantity} - $${lineTotal}`);

    item.extras.forEach((extra) => {
      lines.push(`   + ${extra.name} (+$${extra.price})`);
    });

    item.modifiers.forEach((modifier) => {
      lines.push(`   - ${modifier}`);
    });
  });

  lines.push("", `Total: $${total}`);
  return lines.join("\n");
}

function parseMenuSelection(message: string): ParsedSelection | null {
  const match = message.trim().match(/^(\d+)(?:\s*x\s*(\d+))?(.*)$/i);

  if (!match) {
    return null;
  }

  const itemIndex = Number(match[1]);
  const quantity = match[2] ? Number(match[2]) : 1;
  const trailing = (match[3] || "").trim();

  if (!Number.isInteger(itemIndex) || itemIndex < 1 || !Number.isInteger(quantity) || quantity < 1) {
    return null;
  }

  const extras: string[] = [];
  const modifiers: string[] = [];
  const tokenRegex = /(sin|con\s+extra|extra)\s+(.+?)(?=\s+(?:sin|con\s+extra|extra)\s+|$)/gi;

  for (const tokenMatch of trailing.matchAll(tokenRegex)) {
    const command = normalizeText(tokenMatch[1] || "");
    const value = (tokenMatch[2] || "").trim();

    if (!value) {
      continue;
    }

    if (command === "sin") {
      modifiers.push(`sin ${value}`);
      continue;
    }

    const extraName = value.toLowerCase().startsWith("extra ") ? value : `extra ${value}`;
    extras.push(extraName);
  }

  return { itemIndex, quantity, extras, modifiers };
}

function parseCartEditCommand(message: string): CartEditCommand | null {
  const normalized = normalizeText(message);

  if (normalized === "vaciar carrito" || normalized === "limpiar carrito") {
    return { type: "clear" };
  }

  const removeMatch = normalized.match(/^(quitar|eliminar)\s+(\d+)$/);

  if (removeMatch) {
    const itemIndex = Number(removeMatch[2]);

    if (Number.isInteger(itemIndex) && itemIndex > 0) {
      return { type: "remove", itemIndex };
    }
  }

  const updateMatch = normalized.match(/^(cambiar|actualizar)\s+(\d+)\s*x\s*(\d+)$/);

  if (updateMatch) {
    const itemIndex = Number(updateMatch[2]);
    const quantity = Number(updateMatch[3]);

    if (Number.isInteger(itemIndex) && itemIndex > 0 && Number.isInteger(quantity) && quantity > 0) {
      return { type: "update", itemIndex, quantity };
    }
  }

  return null;
}

function getCart(userId: string): CartItem[] {
  return carts[userId] || [];
}

function resolveExtra(product: SushiMenuItem, requestedExtra: string): SushiExtra | null {
  const availableExtras = product.extras || [];
  const normalizedRequested = normalizeText(requestedExtra);

  return (
    availableExtras.find((extra) => normalizeText(extra.name) === normalizedRequested) ||
    availableExtras.find((extra) => normalizeText(extra.name.replace(/^extra\s+/i, "")) === normalizedRequested.replace(/^extra\s+/i, "")) ||
    null
  );
}

function areSameConfiguration(left: CartItem, right: Omit<CartItem, "quantity">): boolean {
  if (left.id !== right.id) {
    return false;
  }

  const leftExtras = left.extras.map((extra) => normalizeText(extra.name)).sort();
  const rightExtras = right.extras.map((extra) => normalizeText(extra.name)).sort();
  const leftModifiers = left.modifiers.map(normalizeText).sort();
  const rightModifiers = right.modifiers.map(normalizeText).sort();

  return (
    JSON.stringify(leftExtras) === JSON.stringify(rightExtras) &&
    JSON.stringify(leftModifiers) === JSON.stringify(rightModifiers)
  );
}

function addToCart(userId: string, product: SushiMenuItem, quantity: number, extraNames: string[], modifiers: string[]): CartItem {
  const userCart = [...getCart(userId)];
  const resolvedExtras = extraNames
    .map((extraName) => resolveExtra(product, extraName))
    .filter((extra): extra is SushiExtra => Boolean(extra))
    .map((extra) => ({ name: extra.name, price: extra.price }));

  const nextItem: Omit<CartItem, "quantity"> = {
    id: product.id,
    name: product.name,
    basePrice: product.price,
    extras: resolvedExtras,
    modifiers,
  };

  const existingItem = userCart.find((item) => areSameConfiguration(item, nextItem));

  if (existingItem) {
    existingItem.quantity += quantity;
    carts[userId] = userCart;
    return existingItem;
  }

  const createdItem: CartItem = {
    ...nextItem,
    quantity,
  };

  userCart.push(createdItem);
  carts[userId] = userCart;
  return createdItem;
}

function removeCartItem(userId: string, itemIndex: number): CartItem | null {
  const userCart = [...getCart(userId)];
  const index = itemIndex - 1;

  if (index < 0 || index >= userCart.length) {
    return null;
  }

  const [removedItem] = userCart.splice(index, 1);
  carts[userId] = userCart;
  return removedItem ?? null;
}

function removeCartItemsByProductId(userId: string, productId: string, quantity: number): CartItem[] {
  const removedItems: CartItem[] = [];

  for (let attempt = 0; attempt < quantity; attempt += 1) {
    const userCart = [...getCart(userId)];
    const index = userCart.findIndex((item) => item.id === productId);

    if (index < 0) {
      break;
    }

    const [removedItem] = userCart.splice(index, 1);
    carts[userId] = userCart;

    if (removedItem) {
      removedItems.push(removedItem);
    }
  }

  return removedItems;
}

function updateCartItemQuantity(userId: string, itemIndex: number, quantity: number): CartItem | null {
  const userCart = [...getCart(userId)];
  const index = itemIndex - 1;
  const currentItem = userCart[index];

  if (index < 0 || index >= userCart.length || !currentItem) {
    return null;
  }

  userCart[index] = {
    ...currentItem,
    quantity,
  };
  carts[userId] = userCart;
  return userCart[index] ?? null;
}

function clearCart(userId: string): void {
  delete carts[userId];
}

function getCartSummary(userId: string): string {
  const cart = getCart(userId);
  return cart.length > 0 ? formatCart(cart) : "Tu carrito esta vacio";
}

function buildAddConfirmation(item: CartItem, addedQuantity: number): string {
  const lines = [`Te agregue ${addedQuantity} x ${item.name}`];

  item.extras.forEach((extra) => {
    lines.push(`Extra: ${extra.name.replace(/^extra\s+/i, "")} (+$${extra.price})`);
  });

  item.modifiers.forEach((modifier) => {
    const label = modifier.charAt(0).toUpperCase() + modifier.slice(1);
    lines.push(label);
  });

  return lines.join("\n");
}

function buildIntentPrompt(): string {
  return `You are an intent parser for a sushi ordering system.

Return ONLY valid JSON.

Actions allowed:
- show_menu
- add_to_cart
- view_cart
- remove_item
- recommend
- none

Menu:
${JSON.stringify(sushiMenu)}

Examples:

User: "quiero 2 california"
-> {"action":"add_to_cart","items":[{"id":1,"quantity":2}]}

User: "ver menu"
-> {"action":"show_menu"}

User: "ver carrito"
-> {"action":"view_cart"}

User: "quita un california"
-> {"action":"remove_item","items":[{"id":1,"quantity":1}]}

User: "hola"
-> {"action":"none"}

IMPORTANT:
- NEVER return text
- ONLY JSON
- Use the numeric menu position as item id
- If the user is just chatting, greeting, asking something broad, or off topic, return {"action":"none"}
- For add_to_cart and remove_item, include items
- Quantity must be a positive integer`;
}

function buildConversationalPrompt(): string {
  return `You are a real human assistant working in a sushi restaurant via WhatsApp.

Your personality:
- friendly
- natural
- warm
- casual (not too formal)
- NOT robotic

Rules:
- NEVER repeat phrases like "Claro puedo ayudarte con eso"
- ALWAYS vary responses
- keep messages short
- guide the user toward ordering

If user goes off-topic:
-> respond naturally and redirect

Examples:

User: "que venden?"
-> "Tenemos sushi 🍣, rolls especiales y bebidas. Si quieres, te muestro el menu 😊"

User: "cuanto cuesta bitcoin?"
-> "😅 no se mucho de eso, pero si puedo ayudarte con tu pedido de sushi 🍣"

Tone:
- human
- natural
- slightly informal
- use emojis occasionally (not too many)

You are allowed to:
- answer food questions
- talk naturally
- redirect back to ordering
- suggest menu, cart, or recommendations

Return ONLY plain text in Spanish.`;
}

function parseIntentResult(content: string): IntentResult | null {
  try {
    const parsed = JSON.parse(content) as {
      action?: string;
      items?: unknown;
    };

    if (!parsed || typeof parsed !== "object" || typeof parsed.action !== "string") {
      return null;
    }

    if (parsed.action === "show_menu") {
      return { action: "show_menu" };
    }

    if (parsed.action === "view_cart") {
      return { action: "view_cart" };
    }

    if (parsed.action === "recommend") {
      return { action: "recommend" };
    }

    if (parsed.action === "none") {
      return { action: "none" };
    }

    if (parsed.action === "add_to_cart" || parsed.action === "remove_item") {
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        return null;
      }

      const items = parsed.items
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const candidate = item as IntentItem;
          const quantity =
            typeof candidate.quantity === "number" && Number.isInteger(candidate.quantity) && candidate.quantity > 0
              ? candidate.quantity
              : 1;

          if (typeof candidate.id !== "number" && typeof candidate.id !== "string") {
            return null;
          }

          return {
            id: candidate.id,
            quantity,
          };
        })
        .filter((item): item is Required<IntentItem> => Boolean(item));

      if (items.length === 0) {
        return null;
      }

      return {
        action: parsed.action,
        items,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function resolveMenuItemFromIntent(itemId: number | string): SushiMenuItem | null {
  if (typeof itemId === "number") {
    return (sushiMenu[itemId - 1] as SushiMenuItem | undefined) ?? null;
  }

  const normalizedId = normalizeText(itemId);

  return (
    (sushiMenu.find((item) => normalizeText(item.id) === normalizedId || normalizeText(item.name) === normalizedId) as
      | SushiMenuItem
      | undefined) ?? null
  );
}

async function createOpenAICompletion(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, jsonMode = false): Promise<string | null> {
  const { OPENAI_API_KEY: apiKey } = requireEnv("OPENAI_API_KEY");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        ...(jsonMode
          ? {
              response_format: {
                type: "json_object",
              },
            }
          : {}),
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("OpenAI request failed", {
        status: response.status,
        body: errorText,
      });
      return null;
    }

    const data = (await response.json()) as OpenAIChatResponse;
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("OpenAI request error:", error);
    return null;
  }
}

async function interpretUserIntent(userMessage: string): Promise<IntentResult> {
  const systemPrompt = buildIntentPrompt();
  const firstAttempt = await createOpenAICompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    true
  );

  const parsedFirstAttempt = firstAttempt ? parseIntentResult(firstAttempt) : null;
  if (parsedFirstAttempt) {
    return parsedFirstAttempt;
  }

  const retryAttempt = await createOpenAICompletion(
    [
      { role: "system", content: `${systemPrompt}\n\nPrevious output was invalid. Return only valid JSON.` },
      { role: "user", content: userMessage },
    ],
    true
  );

  const parsedRetry = retryAttempt ? parseIntentResult(retryAttempt) : null;
  return parsedRetry ?? { action: "none" };
}

async function generateConversationalResponse(userMessage: string, history: ConversationMessage[]): Promise<string> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: buildConversationalPrompt() },
    ...history.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await createOpenAICompletion(messages);
  return response || NATURAL_FALLBACK_MESSAGE;
}

function combineReply(primary: string | null, conversational: string): string {
  const cleanedPrimary = primary?.trim();
  const cleanedConversational = conversational.trim();

  if (!cleanedPrimary) {
    return cleanedConversational;
  }

  if (normalizeText(cleanedPrimary) === normalizeText(cleanedConversational)) {
    return cleanedPrimary;
  }

  return `${cleanedPrimary}\n\n${cleanedConversational}`;
}

function handleManualCartLogic(userId: string, userMessage: string): string | null {
  const normalizedMessage = normalizeText(userMessage);

  const editCommand = parseCartEditCommand(userMessage);
  if (editCommand) {
    if (editCommand.type === "clear") {
      clearCart(userId);
      return "Tu carrito ha sido vaciado.";
    }

    if (editCommand.type === "remove") {
      const removedItem = removeCartItem(userId, editCommand.itemIndex);
      return removedItem ? `Elimine ${removedItem.name} del carrito.` : "Ese producto no existe en tu carrito.";
    }

    const updatedItem = updateCartItemQuantity(userId, editCommand.itemIndex, editCommand.quantity);
    return updatedItem ? `Actualice ${updatedItem.name} a x${editCommand.quantity}.` : "Ese producto no existe en tu carrito.";
  }

  const selection = parseMenuSelection(userMessage);
  if (selection) {
    const item = sushiMenu[selection.itemIndex - 1] as SushiMenuItem | undefined;

    if (!item) {
      return "Ese numero no existe en el menu.";
    }

    const cartItem = addToCart(userId, item, selection.quantity, selection.extras, selection.modifiers);
    return buildAddConfirmation(cartItem, selection.quantity);
  }

  if (normalizedMessage === "menu") {
    return formatMenu(sushiMenu);
  }

  if (normalizedMessage === "carrito") {
    return getCartSummary(userId);
  }

  if (normalizedMessage === "cancelar") {
    clearCart(userId);
    return "Tu carrito ha sido cancelado.";
  }

  return null;
}

function executeIntent(userId: string, intent: IntentResult): string | null {
  if (intent.action === "show_menu") {
    return formatMenu(sushiMenu);
  }

  if (intent.action === "view_cart") {
    return getCartSummary(userId);
  }

  if (intent.action === "recommend") {
    return formatRecommendations(sushiMenu);
  }

  if (intent.action === "add_to_cart") {
    const confirmations = intent.items
      .map((requestedItem) => {
        if (typeof requestedItem.id !== "number" && typeof requestedItem.id !== "string") {
          return null;
        }

        const item = resolveMenuItemFromIntent(requestedItem.id);
        if (!item) {
          return null;
        }

        const quantity = requestedItem.quantity ?? 1;
        const cartItem = addToCart(userId, item, quantity, [], []);
        return buildAddConfirmation(cartItem, quantity);
      })
      .filter((message): message is string => Boolean(message));

    return confirmations.length > 0 ? confirmations.join("\n\n") : "No encontre esos productos en el menu.";
  }

  if (intent.action === "remove_item") {
    const removals = intent.items
      .map((requestedItem) => {
        if (typeof requestedItem.id !== "number" && typeof requestedItem.id !== "string") {
          return null;
        }

        const item = resolveMenuItemFromIntent(requestedItem.id);
        if (!item) {
          return null;
        }

        const removedItems = removeCartItemsByProductId(userId, item.id, requestedItem.quantity ?? 1);
        return removedItems.length > 0 ? `Quite ${removedItems.length} x ${item.name} del carrito.` : null;
      })
      .filter((message): message is string => Boolean(message));

    return removals.length > 0 ? removals.join("\n") : "No pude identificar que producto quitar del carrito.";
  }

  return null;
}

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId } = requireEnv(
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID"
  );

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: text,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("Failed to send WhatsApp message", {
      status: response.status,
      body: errorText,
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      const mode = getQueryParam(req.query["hub.mode"]);
      const verifyToken = getQueryParam(req.query["hub.verify_token"]);
      const challenge = getQueryParam(req.query["hub.challenge"]);

      if (mode === "subscribe" && verifyToken === getVerifyToken()) {
        res.status(200).send(challenge);
        return;
      }

      res.status(403).json({ error: "Invalid verification token" });
      return;
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as WhatsAppWebhookBody;
      const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      try {
        console.log(JSON.stringify(body, null, 2));
      } catch {
        console.log("Received WhatsApp webhook event, but body could not be stringified.");
      }

      if (message?.from && message.text?.body) {
        const to = message.from;
        const userMessage = message.text.body;
        const history = getConversationHistory(to);

        console.log("Sending message to:", to);
        console.log("User message:", userMessage);

        const intent = await interpretUserIntent(userMessage);
        console.log("Parsed intent:", JSON.stringify(intent));

        const actionResult = executeIntent(to, intent) ?? handleManualCartLogic(to, userMessage);
        const conversationalReply = await generateConversationalResponse(userMessage, history);
        const finalReply = combineReply(actionResult, conversationalReply);

        await sendWhatsAppMessage(to, finalReply);
        saveConversationTurn(to, userMessage, finalReply);
      }

      res.status(200).json({ status: "ok" });
      return;
    }

    res.status(200).json({ status: "ignored" });
  } catch (error) {
    console.error("Webhook handler error:", error);

    if (!res.headersSent) {
      res.status(200).json({ status: "ok" });
    }
  }
}
