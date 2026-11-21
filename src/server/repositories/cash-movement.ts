import { Prisma } from "@/generated/prisma/client";

export type CashMovementTotals = {
  received: string;
  paid: string;
  balanceInHand: string;
};

type CashMovementRange = { from?: string | Date; through: string | Date };

function dateKey(date: string | Date) {
  return typeof date === "string" ? date : date.toISOString().slice(0, 10);
}

// The journal amount is negative on issuance and positive on reversal for both
// flows. Use the posting's date so a later bounce appears in its own period.
export async function getCashMovementTotals(
  tx: Prisma.TransactionClient,
  { from, through }: CashMovementRange,
): Promise<CashMovementTotals> {
  const start = from
    ? Prisma.sql`AND entry.business_date >= ${dateKey(from)}::date`
    : Prisma.empty;
  const [totals] = await tx.$queryRaw<CashMovementTotals[]>(Prisma.sql`
    SELECT
      (-COALESCE(SUM(entry.amount) FILTER (WHERE entry.kind = 'CUSTOMER_RECEIPT'), 0))::text AS received,
      (-COALESCE(SUM(entry.amount) FILTER (WHERE entry.kind = 'SUPPLIER_PAYMENT'), 0))::text AS paid,
      COALESCE(SUM(CASE WHEN entry.kind = 'CUSTOMER_RECEIPT' THEN -entry.amount ELSE entry.amount END), 0)::text AS "balanceInHand"
    FROM payments AS voucher
    JOIN ledger_entries AS entry ON entry.payment_id = voucher.id
    WHERE voucher.method <> 'ADJUSTMENT'
      AND entry.kind IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT')
      AND entry.business_date <= ${dateKey(through)}::date ${start}
  `);
  return totals;
}
