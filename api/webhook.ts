import type { VercelRequest, VercelResponse } from "@vercel/node";

import { env } from "../src/utils/env";
import { createLogger } from "../src/services/logger";

const logger = createLogger("webhook");

export default function handler(req: VercelRequest, res: VercelResponse): void {
  logger.info("Webhook placeholder invoked", {
    method: req.method,
    hasVerificationToken: Boolean(env.WHATSAPP_VERIFY_TOKEN),
  });

  res.status(202).json({
    message: "Webhook handler placeholder",
  });
}

