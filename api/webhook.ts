import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sushiMenu } from "../lib/sushiMenu";

type SushiMenuItem = (typeof sushiMenu)[number];

type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
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

function formatMenu(menu: typeof sushiMenu): string {
  const items = menu.map((item, index) => `${index + 1}. ${item.name} - $${item.price}`);
  return ["🍣 MENÚ SUSHI", "", ...items].join("\n");
}

function formatCart(cart: CartItem[]): string {
  const items = cart.map((item, index) => `${index + 1}. ${item.name} x${item.quantity} - $${item.price * item.quantity}`);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return ["🛒 TU CARRITO", "", ...items, "", `Total: $${total}`].join("\n");
}

function parseMenuSelection(message: string): { itemIndex: number; quantity: number } | null {
  const match = message.trim().match(/^(\d+)(?:\s*x\s*(\d+))?$/i);

  if (!match) {
    return null;
  }

  const itemIndex = Number(match[1]);
  const quantity = match[2] ? Number(match[2]) : 1;

  if (!Number.isInteger(itemIndex) || itemIndex < 1 || !Number.isInteger(quantity) || quantity < 1) {
    return null;
  }

  return { itemIndex, quantity };
}

function getCart(userId: string): CartItem[] {
  return carts[userId] || [];
}

function addToCart(userId: string, product: SushiMenuItem, quantity: number): CartItem[] {
  const userCart = [...getCart(userId)];
  const existingItem = userCart.find((item) => item.id === product.id);

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    userCart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity,
    });
  }

  carts[userId] = userCart;
  return userCart;
}

function getCartSummary(userId: string): string {
  const cart = getCart(userId);
  return cart.length > 0 ? formatCart(cart) : "Tu carrito esta vacio";
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
        const normalizedMessage = userMessage.trim().toLowerCase();
        console.log("Sending message to:", to);
        console.log("User message:", userMessage);

        if (normalizedMessage === "menu") {
          console.log("User requested menu");
          const menuText = formatMenu(sushiMenu);
          await sendWhatsAppMessage(to, menuText);
          res.status(200).json({ status: "ok" });
          return;
        }

        const selection = parseMenuSelection(normalizedMessage);

        if (selection) {
          const itemIndex = selection.itemIndex - 1;
          const item = sushiMenu[itemIndex];

          if (item) {
            addToCart(to, item, selection.quantity);
            await sendWhatsAppMessage(to, `Agregaste ${item.name} 🍣 (x${selection.quantity})`);
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
