import type { Prisma, Session } from "@prisma/client";

import { prisma } from "../db/client";
import type { CartState } from "../cart/cart.service";
import { createEmptyCart } from "../cart/cart.service";

type SessionContext = {
  cart?: CartState;
};

function readContext(session: Session): SessionContext {
  const snapshot = session.contextSnapshot;

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {};
  }

  return snapshot as SessionContext;
}

export async function getOrCreateActiveSession(userId: string): Promise<Session> {
  const existing = await prisma.session.findFirst({
    where: {
      userId,
      status: "ACTIVE",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existing) {
    return prisma.session.update({
      where: { id: existing.id },
      data: { lastMessageAt: new Date() },
    });
  }

  return prisma.session.create({
    data: {
      userId,
      lastMessageAt: new Date(),
      contextSnapshot: { cart: createEmptyCart() } satisfies Prisma.InputJsonValue,
    },
  });
}

export function getCartFromSession(session: Session): CartState {
  return readContext(session).cart ?? createEmptyCart();
}

export async function saveCartToSession(sessionId: string, cart: CartState): Promise<Session> {
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      lastMessageAt: new Date(),
      contextSnapshot: { cart } satisfies Prisma.InputJsonValue,
    },
  });
}
