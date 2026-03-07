import type { VercelRequest, VercelResponse } from "@vercel/node";

function getQueryParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getVerifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN || "restaurant_verify_token";
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
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
      try {
        console.log(JSON.stringify(req.body ?? {}, null, 2));
      } catch {
        console.log("Received WhatsApp webhook event, but body could not be stringified.");
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
