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

export async function touchUserActivity(whatsappUserId: string): Promise<User> {
  const user = await findOrCreateUserByWhatsappId(whatsappUserId);

  return prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      lastActivityAt: new Date(),
      lastReminderSentAt: null,
    },
  });
}

export async function findUsersNeedingReminder(cutoff: Date): Promise<User[]> {
  return prisma.user.findMany({
    where: {
      lastActivityAt: {
        lt: cutoff,
      },
      lastReminderSentAt: null,
      phoneNumber: {
        not: null,
      },
    },
  });
}

export async function markReminderSent(userId: string): Promise<User> {
  return prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      lastReminderSentAt: new Date(),
    },
  });
}
