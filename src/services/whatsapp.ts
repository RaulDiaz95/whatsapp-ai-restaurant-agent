import { getWhatsappEnv } from "../utils/env";

type WhatsAppSendMessageResponse = {
  messages?: Array<{ id: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const env = getWhatsappEnv();
  const url = `https://graph.facebook.com/v18.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
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

  if (response.ok) {
    return;
  }

  const errorBody = (await response.json().catch(() => null)) as WhatsAppSendMessageResponse | null;
  const errorMessage = errorBody?.error?.message ?? `WhatsApp API request failed with status ${response.status}`;

  throw new Error(errorMessage);
}
