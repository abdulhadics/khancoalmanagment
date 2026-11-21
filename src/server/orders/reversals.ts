import type { Prisma } from "@/generated/prisma/client";
import { OrderMutationError } from "./order-mutation-error";

export async function readLiveOrderPostings(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const entries = await tx.ledgerEntry.findMany({
    where: {
      orderRevision: { is: { orderId } },
      reversesId: null,
      reversal: { is: null },
    },
    select: {
      id: true,
      kind: true,
      amount: true,
      businessDate: true,
      orderRevisionId: true,
      customerId: true,
      supplierId: true,
    },
  });
  const sale = entries.find(({ kind }) => kind === "ORDER_SALE");
  const purchase = entries.find(({ kind }) => kind === "ORDER_PURCHASE");
  if (
    entries.length !== 2 ||
    !sale ||
    !purchase ||
    !sale.orderRevisionId ||
    sale.orderRevisionId !== purchase.orderRevisionId ||
    sale.businessDate.getTime() !== purchase.businessDate.getTime()
  ) {
    throw new OrderMutationError("integrity");
  }
  return { sale, purchase };
}

type LiveOrderPostings = Awaited<ReturnType<typeof readLiveOrderPostings>>;

export async function reverseOrderPostings(
  tx: Prisma.TransactionClient,
  pair: LiveOrderPostings,
  actorId: string,
  reason: string,
) {
  await tx.ledgerEntry.createMany({
    data: [pair.sale, pair.purchase].map(({ id, amount, ...entry }) => ({
      ...entry,
      reversesId: id,
      amount: amount.negated().toFixed(2),
      actorId,
      reason,
    })),
  });
}
