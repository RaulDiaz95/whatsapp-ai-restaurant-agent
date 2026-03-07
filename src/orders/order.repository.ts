import type { Order, Prisma } from "@prisma/client";

import { prisma } from "../db/client";

export async function createOrder(data: Prisma.OrderUncheckedCreateInput): Promise<Order> {
  return prisma.order.create({
    data,
  });
}

