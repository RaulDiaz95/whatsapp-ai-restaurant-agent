import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sushiMenu } from "../lib/sushiMenu";

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

const carts: Record<string, CartItem[]> = {};

function getQueryParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getVerifyToken(): string {
  return process.env.VERIFY_TOKEN || "";
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
  return ["🍣 MENÚ SUSHI", "", ...items].join("\n");
}

function getUnitPrice(item: CartItem): number {
  const extrasTotal = item.extras.reduce((sum, extra) => sum + extra.price, 0);
  return item.basePrice + extrasTotal;
}

function formatCart(cart: CartItem[]): string {
  const lines: string[] = ["🛒 TU CARRITO", ""];
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

function getCartSummary(userId: string): string {
  const cart = getCart(userId);
  return cart.length > 0 ? formatCart(cart) : "Tu carrito esta vacio";
}

function buildAddConfirmation(item: CartItem, addedQuantity: number): string {
  const lines = [`Agregaste ${item.name} 🍣 (x${addedQuantity})`];

  item.extras.forEach((extra) => {
    lines.push(`Extra: ${extra.name.replace(/^extra\s+/i, "")} (+$${extra.price})`);
  });

  item.modifiers.forEach((modifier) => {
    const label = modifier.charAt(0).toUpperCase() + modifier.slice(1);
    lines.push(label);
  });

  return lines.join("\n");
}

async function generateAIResponse(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || "";

  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY");
    return "Hola, puedo ayudarte con el menu, recomendaciones de sushi o tu pedido. Que se te antoja?";
  }

  const systemPrompt = `You are a friendly assistant for a sushi restaurant.
You speak Spanish.
Be short, natural and friendly.

You can help with:
- showing the menu
- recommending sushi
- answering questions about ingredients
- taking simple orders

Menu:
- California Roll
- Philadelphia Roll
- Spicy Tuna Roll
- Tempura Roll
- Sushi Mixto
- Bebidas: té, refrescos

Always guide the user to order or ask for more information.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
      return "Hola, puedo ayudarte con el menu, recomendaciones de sushi o tu pedido. Que te gustaria pedir?";
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return (
      data.choices?.[0]?.message?.content?.trim() ||
      "Hola, puedo ayudarte con el menu, recomendaciones de sushi o tu pedido. Que te gustaria pedir?"
    );
  } catch (error) {
    console.error("OpenAI request error:", error);
    return "Hola, puedo ayudarte con el menu, recomendaciones de sushi o tu pedido. Que te gustaria pedir?";
  }
}

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN || "";
  const phoneNumberId = process.env.PHONE_NUMBER_ID || "";

  if (!token || !phoneNumberId) {
    console.error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
    return;
  }

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
          console.log("User requested menu");
          const menuText = formatMenu(sushiMenu);
          await sendWhatsAppMessage(to, menuText);
          res.status(200).json({ status: "ok" });
          return;
        }

        const selection = parseMenuSelection(userMessage);

        if (selection) {
          const itemIndex = selection.itemIndex - 1;
          const item = sushiMenu[itemIndex] as SushiMenuItem | undefined;

          if (item) {
            const cartItem = addToCart(to, item, selection.quantity, selection.extras, selection.modifiers);
            const confirmation = buildAddConfirmation(cartItem, selection.quantity);
            await sendWhatsAppMessage(to, confirmation);
          } else {
            await sendWhatsAppMessage(to, "Ese numero no existe en el menu");
          }

          res.status(200).json({ status: "ok" });
          return;
        }

        if (normalizedMessage === "carrito") {
          const cartText = getCartSummary(to);
          await sendWhatsAppMessage(to, cartText);
          res.status(200).json({ status: "ok" });
          return;
        }

        if (normalizedMessage === "cancelar") {
          delete carts[to];
          await sendWhatsAppMessage(to, "Tu carrito ha sido cancelado");
          res.status(200).json({ status: "ok" });
          return;
        }

        const reply = await generateAIResponse(userMessage);
        console.log("AI reply:", reply);
        await sendWhatsAppMessage(to, reply);
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
