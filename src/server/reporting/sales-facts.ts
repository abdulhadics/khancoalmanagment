import { Prisma } from "../../generated/prisma/client";
import { businessDateConditions, type ReportPeriod } from "./period";

export type SalesFactFilter = ReportPeriod & {
  customerId?: string;
  supplierId?: string;
  mineId?: string;
  matchingOrders?: Prisma.Sql;
};

export type SalesTotals = {
  trucks: number;
  weight: string;
  sales: string;
  purchases: string;
  profit: string;
};

export const summedSalesMeasures = Prisma.sql`
  COALESCE(SUM(trucks), 0)::bigint AS trucks,
  COALESCE(SUM(weight), 0)::text AS weight,
  COALESCE(SUM(sales), 0)::text AS sales,
  COALESCE(SUM(purchases), 0)::text AS purchases,
  COALESCE(SUM(sales) - SUM(purchases), 0)::text AS profit
`;

// Both sides contribute their own signed posted amount. Count each dispatch
// and its weight once, from the sales side, including zero-rated dispatches.
export function signedSalesFacts(filter: SalesFactFilter = {}) {
  const conditions = [
    Prisma.sql`entry.kind IN ('ORDER_SALE', 'ORDER_PURCHASE')`,
    ...businessDateConditions(Prisma.sql`entry.business_date`, filter),
  ];
  if (filter.customerId)
    conditions.push(
      Prisma.sql`revision.customer_id = ${filter.customerId}::uuid`,
    );
  if (filter.supplierId)
    conditions.push(
      Prisma.sql`revision.supplier_id = ${filter.supplierId}::uuid`,
    );
  if (filter.mineId)
    conditions.push(Prisma.sql`revision.mine_id = ${filter.mineId}::uuid`);
  if (filter.matchingOrders) {
    conditions.push(
      Prisma.sql`revision.order_id IN (${filter.matchingOrders})`,
    );
  }
  return Prisma.sql`
    SELECT
      entry.id AS posting_id,
      entry.business_date,
      revision.order_id,
      revision.customer_id,
      revision.supplier_id,
      revision.mine_id,
      CASE WHEN entry.kind = 'ORDER_SALE' THEN
        CASE WHEN entry.reverses_id IS NULL THEN 1 ELSE -1 END
        ELSE 0 END AS trucks,
      CASE WHEN entry.kind = 'ORDER_SALE' THEN
        CASE WHEN entry.reverses_id IS NULL THEN revision.weight ELSE -revision.weight END
        ELSE 0 END AS weight,
      CASE WHEN entry.kind = 'ORDER_SALE' THEN entry.amount ELSE 0 END AS sales,
      CASE WHEN entry.kind = 'ORDER_PURCHASE' THEN entry.amount ELSE 0 END AS purchases
    FROM ledger_entries AS entry
    JOIN order_revisions AS revision ON revision.id = entry.order_revision_id
    WHERE ${Prisma.join(conditions, " AND ")}
  `;
}

export async function readSalesSummary(
  tx: Prisma.TransactionClient,
  filter: SalesFactFilter = {},
): Promise<SalesTotals> {
  const [total] = await tx.$queryRaw<
    (Omit<SalesTotals, "trucks"> & { trucks: bigint })[]
  >`
    SELECT ${summedSalesMeasures}
    FROM (${signedSalesFacts(filter)}) AS facts
  `;
  if (!total) throw new Error("Sales aggregation returned no result.");
  return { ...total, trucks: Number(total.trucks) };
}

export async function readMonthlySales(
  tx: Prisma.TransactionClient,
  filter: SalesFactFilter,
) {
  const rows = await tx.$queryRaw<
    (Omit<SalesTotals, "trucks"> & { month: string; trucks: bigint })[]
  >`
    SELECT to_char(date_trunc('month', business_date), 'YYYY-MM') AS month,
      ${summedSalesMeasures}
    FROM (${signedSalesFacts(filter)}) AS facts
    GROUP BY date_trunc('month', business_date)
    ORDER BY month
  `;
  return rows.map((row) => ({ ...row, trucks: Number(row.trucks) }));
}
