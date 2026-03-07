import type { User } from "@prisma/client";

import { prisma } from "../db/client";

export async function findUserByWhatsappId(whatsappUserId: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: {
      whatsappUserId,
    },
  });
}

