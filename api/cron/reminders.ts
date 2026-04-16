import type { VercelRequest, VercelResponse } from "@vercel/node";

import { markReminderSent, findUsersNeedingReminder } from "../../src/users/user.repository";
import { sendTextMessage } from "../../src/services/whatsapp";

const REMINDER_MESSAGE = "👋 ¿Sigues ahí? Puedo ayudarte a terminar tu pedido o agregar algo más 🍣";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  try {
    const users = await findUsersNeedingReminder(fiveMinutesAgo);

    for (const user of users) {
      const destination = user.phoneNumber ?? user.whatsappUserId;
      await sendTextMessage(destination, REMINDER_MESSAGE);
      await markReminderSent(user.id);
    }

    res.status(200).json({
      ok: true,
      remindedUsers: users.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reminders error";
    res.status(500).json({ error: message });
  }
}
