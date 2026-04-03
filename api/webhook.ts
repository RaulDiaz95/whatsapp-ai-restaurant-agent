import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sushiMenu } from "../lib/sushiMenu";
import { getEnv, requireEnv } from "../src/utils/env";

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

type AIActionItem = {
  id?: number | string;
  quantity?: number;
};

type AIAction =
  | {
      action: "show_menu";
    }
  | {
      action: "add_to_cart";
      items: AIActionItem[];
    }
  | {
      action: "view_cart";
    }
  | {
      action: "remove_items";
      items: AIActionItem[];
    }
  | {
      action: "recommend";
    }
  | {
      action: "chat";
      message: string;
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

const carts: Record<string, CartItem[]> = {};
const FALLBACK_CHAT_MESSAGE = "Hola, puedo ayudarte con el menu, recomendaciones de sushi o tu pedido. Que te gustaria pedir?";

function getQueryParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getVerifyToken(): string {
  return requireEnv("WHATSAPP_VERIFY_TOKEN").WHATSAPP_VERIFY_TOKEN;
}

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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const lines = [`Agregaste ${item.name} (x${addedQuantity})`];

  item.extras.forEach((extra) => {
    lines.push(`Extra: ${extra.name.replace(/^extra\s+/i, "")} (+$${extra.price})`);
  });

  item.modifiers.forEach((modifier) => {
    const label = modifier.charAt(0).toUpperCase() + modifier.slice(1);
    lines.push(label);
  });

  return lines.join("\n");
}

function buildMenuPrompt(menu: typeof sushiMenu): string {
  const actionMenu = menu.map((item, index) => ({
    id: index + 1,
    name: item.name,
    price: item.price,
  }));

  return `You are a friendly sushi restaurant assistant speaking on WhatsApp.
You represent a sushi restaurant and should feel like a real person taking an order.
You MUST return ONLY valid JSON.
Do NOT return plain text outside JSON.
Always write short, natural, human Spanish.
Do not sound robotic, stiff, or repetitive.
Never keep repeating phrases like "Claro, puedo ayudarte con eso".
Vary wording naturally across replies.

You can:
- show the menu
- help build an order
- recommend items
- answer questions about food
- handle off-topic messages gracefully and redirect back to ordering

If the user goes off topic:
- respond naturally
- do not say you cannot help in a robotic way
- gently redirect to the menu, cart, recommendations, or ordering

Examples of tone:
- User: "que venden aqui?"
  Reply idea: "Tenemos sushi, rolls especiales y bebidas. Si quieres, te muestro el menu completo."
- User: "tienen bebidas?"
  Reply idea: "Si, tenemos te y refrescos. Si quieres, te sugiero algo para tomar."
- User: "cuanto cuesta bitcoin?"
  Reply idea: "No manejo eso, pero si quieres te ayudo con tu pedido de sushi. Te muestro el menu o te recomiendo algo."

Menu:
${JSON.stringify(menu)}

Each item has:
- id
- name
- price

Action menu reference:
${JSON.stringify(actionMenu)}

Understand natural language like:
- "quiero un spicy tuna y 2 california"
- "agrega un california"
- "muestrame el menu"
- "que recomiendas"
- "que venden aqui?"

Convert user input into structured actions.
Always include a natural message field.

Allowed actions:
- show_menu
- add_to_cart
- view_cart
- recommend
- chat

Valid JSON shapes:
{"action":"show_menu","message":"Te paso el menu para que lo veas."}
{"action":"add_to_cart","message":"Listo, te lo agrego.","items":[{"id":1,"quantity":2},{"id":3,"quantity":1}]}
{"action":"view_cart","message":"Te muestro tu carrito."}
{"action":"recommend","message":"Te recomiendo algo rico."}
{"action":"chat","message":"Si, tenemos te y refrescos. Si quieres, tambien te muestro el menu."}

Rules:
- For add_to_cart, always include items.
- Use the numeric menu id from the action menu reference.
- The message field must always feel natural and human.
- Keep responses short and friendly.
- Always guide the conversation back to ordering, viewing the menu, adding items, or checkout.
- Return ONLY valid JSON.`;
}

function parseAIAction(content: string): AIAction | null {
  try {
    const parsed = JSON.parse(content) as Partial<AIAction> & {
      items?: unknown;
      message?: unknown;
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

    if (parsed.action === "chat") {
      if (typeof parsed.message !== "string" || parsed.message.trim().length === 0) {
        return null;
      }

      return {
        action: "chat",
        message: parsed.message.trim(),
      };
    }

    if (parsed.action === "add_to_cart" || parsed.action === "remove_items") {
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        return null;
      }

      const items = parsed.items
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const candidate = item as AIActionItem;
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
        .filter((item): item is Required<AIActionItem> => Boolean(item));

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

function resolveMenuItemFromAI(itemId: number | string): SushiMenuItem | null {
  if (typeof itemId === "number") {
    return (sushiMenu[itemId - 1] as SushiMenuItem | undefined) ?? null;
  }

  const normalizedId = normalizeText(itemId);

  return (
    (sushiMenu.find((item) => {
      return normalizeText(item.id) === normalizedId || normalizeText(item.name) === normalizedId;
    }) as SushiMenuItem | undefined) ?? null
  );
}

async function requestAIAction(userMessage: string, systemPrompt: string): Promise<AIAction | null> {
  const { OPENAI_API_KEY: apiKey } = requireEnv("OPENAI_API_KEY");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("Failed to generate AI response", {
        status: response.status,
        body: errorText,
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    return content ? parseAIAction(content) : null;
  } catch (error) {
    console.error("OpenAI request error:", error);
    return null;
  }
}

async function generateAIResponse(userMessage: string): Promise<AIAction> {
  const systemPrompt = buildMenuPrompt(sushiMenu);
  const firstAttempt = await requestAIAction(userMessage, systemPrompt);

  if (firstAttempt) {
    return firstAttempt;
  }

  const retryPrompt = `${systemPrompt}

Previous response was invalid because it was not parseable JSON.
Return ONLY valid JSON now.`;
  const secondAttempt = await requestAIAction(userMessage, retryPrompt);

  if (secondAttempt) {
    return secondAttempt;
  }

  return {
    action: "chat",
    message: FALLBACK_CHAT_MESSAGE,
  };
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
        const normalizedMessage = normalizeText(userMessage);
        console.log("Sending message to:", to);
        console.log("User message:", userMessage);

        if (normalizedMessage === "menu") {
          await sendWhatsAppMessage(to, formatMenu(sushiMenu));
          res.status(200).json({ status: "ok" });
          return;
        }

        const editCommand = parseCartEditCommand(userMessage);

        if (editCommand) {
          if (editCommand.type === "clear") {
            clearCart(to);
            await sendWhatsAppMessage(to, "Tu carrito ha sido vaciado.");
            res.status(200).json({ status: "ok" });
            return;
          }

          if (editCommand.type === "remove") {
            const removedItem = removeCartItem(to, editCommand.itemIndex);

            if (!removedItem) {
              await sendWhatsAppMessage(to, "Ese producto no existe en tu carrito");
            } else {
              await sendWhatsAppMessage(to, `Eliminaste ${removedItem.name} del carrito`);
            }

            res.status(200).json({ status: "ok" });
            return;
          }

          const updatedItem = updateCartItemQuantity(to, editCommand.itemIndex, editCommand.quantity);

          if (!updatedItem) {
            await sendWhatsAppMessage(to, "Ese producto no existe en tu carrito");
          } else {
            await sendWhatsAppMessage(to, `Actualizaste ${updatedItem.name} a x${editCommand.quantity}`);
          }

          res.status(200).json({ status: "ok" });
          return;
        }

        const selection = parseMenuSelection(userMessage);

        if (selection) {
          const itemIndex = selection.itemIndex - 1;
          const item = sushiMenu[itemIndex] as SushiMenuItem | undefined;

          if (item) {
            const cartItem = addToCart(to, item, selection.quantity, selection.extras, selection.modifiers);
            await sendWhatsAppMessage(to, buildAddConfirmation(cartItem, selection.quantity));
          } else {
            await sendWhatsAppMessage(to, "Ese numero no existe en el menu");
          }

          res.status(200).json({ status: "ok" });
          return;
        }

        if (normalizedMessage === "carrito") {
          await sendWhatsAppMessage(to, getCartSummary(to));
          res.status(200).json({ status: "ok" });
          return;
        }

        if (normalizedMessage === "cancelar") {
          clearCart(to);
          await sendWhatsAppMessage(to, "Tu carrito ha sido cancelado");
          res.status(200).json({ status: "ok" });
          return;
        }

        const aiAction = await generateAIResponse(userMessage);
        console.log("AI action:", JSON.stringify(aiAction));

        if (aiAction.action === "show_menu") {
          await sendWhatsAppMessage(to, formatMenu(sushiMenu));
          res.status(200).json({ status: "ok" });
          return;
        }

        if (aiAction.action === "add_to_cart") {
          const confirmations = aiAction.items
            .map((requestedItem) => {
              if (typeof requestedItem.id !== "number" && typeof requestedItem.id !== "string") {
                return null;
              }

              const item = resolveMenuItemFromAI(requestedItem.id);

              if (!item) {
                return null;
              }

              const quantity = requestedItem.quantity ?? 1;
              const cartItem = addToCart(to, item, quantity, [], []);
              return buildAddConfirmation(cartItem, quantity);
            })
            .filter((messageText): messageText is string => Boolean(messageText));

          await sendWhatsAppMessage(
            to,
            confirmations.length > 0 ? confirmations.join("\n\n") : "No encontre esos productos en el menu."
          );
          res.status(200).json({ status: "ok" });
          return;
        }

        if (aiAction.action === "view_cart") {
          await sendWhatsAppMessage(to, getCartSummary(to));
          res.status(200).json({ status: "ok" });
          return;
        }

        if (aiAction.action === "remove_items") {
          const removals = aiAction.items
            .map((requestedItem) => {
              if (typeof requestedItem.id !== "number" && typeof requestedItem.id !== "string") {
                return null;
              }

              const item = resolveMenuItemFromAI(requestedItem.id);

              if (!item) {
                return null;
              }

              const removedItems = removeCartItemsByProductId(to, item.id, requestedItem.quantity ?? 1);
              if (removedItems.length === 0) {
                return null;
              }

              return `Eliminaste ${item.name} del carrito`;
            })
            .filter((messageText): messageText is string => Boolean(messageText));

          await sendWhatsAppMessage(
            to,
            removals.length > 0 ? removals.join("\n") : "No pude identificar que producto quitar del carrito."
          );
          res.status(200).json({ status: "ok" });
          return;
        }

        if (aiAction.action === "recommend") {
          await sendWhatsAppMessage(to, formatRecommendations(sushiMenu));
          res.status(200).json({ status: "ok" });
          return;
        }

        await sendWhatsAppMessage(to, aiAction.message || FALLBACK_CHAT_MESSAGE);
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
