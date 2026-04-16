import type { VercelRequest, VercelResponse } from "@vercel/node";

import { handleOrderingMessage } from "../src/orders/order-assistant.service";
import { sendTextMessage } from "../src/services/whatsapp";
import { touchUserActivity } from "../src/users/user.repository";
import { getWhatsappEnv } from "../src/utils/env";

type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: { body?: string };
          type?: string;
        }>;
      };
    }>;
  }>;
};

function getIncomingMessage(body: WhatsAppWebhookBody): { from: string; text: string } | null {
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message?.from || message.type !== "text" || !message.text?.body) {
    return null;
  }

  return {
    from: message.from,
    text: message.text.body,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    const env = getWhatsappEnv();
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && typeof challenge === "string") {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).json({ error: "Invalid verification token" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const incomingMessage = getIncomingMessage(req.body as WhatsAppWebhookBody);

    if (!incomingMessage) {
      res.status(200).json({ ok: true });
      return;
    }

    await touchUserActivity(incomingMessage.from);
    const reply = await handleOrderingMessage(incomingMessage.from, incomingMessage.text);
    await sendTextMessage(incomingMessage.from, reply);

    res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    res.status(500).json({ error: message });
  }
}
