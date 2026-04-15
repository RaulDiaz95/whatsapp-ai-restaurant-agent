import type { User } from "@prisma/client";

import { prisma } from "../db/client";

export async function findUserByWhatsappId(whatsappUserId: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: {
      whatsappUserId,
    },
  });
}

export async function findOrCreateUserByWhatsappId(whatsappUserId: string): Promise<User> {
  const existingUser = await findUserByWhatsappId(whatsappUserId);

  if (existingUser) {
    return existingUser;
  }

  return prisma.user.create({
    data: {
      whatsappUserId,
      phoneNumber: whatsappUserId,
    },
  });
}
