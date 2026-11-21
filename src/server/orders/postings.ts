import type { Prisma } from "../../generated/prisma/client";

export type OrderPosting = {
  revisionId: string;
  businessDate: Date;
  customerId: string;
  supplierId: string;
  actorId: string;
  sellAmount: string;
  buyAmount: string;
};

export function orderPostingRows(
  posting: OrderPosting,
): Prisma.LedgerEntryCreateManyInput[] {
  const shared = {
    orderRevisionId: posting.revisionId,
    businessDate: posting.businessDate,
    actorId: posting.actorId,
  };
  return [
    {
      ...shared,
      kind: "ORDER_SALE",
      customerId: posting.customerId,
      amount: posting.sellAmount,
    },
    {
      ...shared,
      kind: "ORDER_PURCHASE",
      supplierId: posting.supplierId,
      amount: posting.buyAmount,
    },
  ];
}

export function appendOrderPostings(
  tx: Prisma.TransactionClient,
  posting: OrderPosting,
) {
  return tx.ledgerEntry.createMany({ data: orderPostingRows(posting) });
}
