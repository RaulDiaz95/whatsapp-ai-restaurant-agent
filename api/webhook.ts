import type { VercelRequest, VercelResponse } from "@vercel/node";

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

      if (message?.from) {
        const to = message.from;
        console.log("Sending message to:", to);
        await sendWhatsAppMessage(to, "Hola 👋 gracias por tu mensaje");
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
