import { todayBusinessDate } from "@/domain/business-date";
import { Prisma } from "@/generated/prisma/client";

type Party = "customer" | "supplier";

type Activity = {
  trucks: number;
  weight: string;
  billed: string;
  settled: string;
  balance: string;
};

export type PartyRollup = Activity & { partyId: string };
export type PartyRollupTotals = Activity & { due: string; advance: string };

type BigIntTrucks<T extends Activity> = Omit<T, "trucks"> & { trucks: bigint };

// matches selects each in-scope party UUID as `id`.
export function partyLedgerRollupQuery(
  party: Party,
  matches: Prisma.Sql,
  asOf: string | Date,
  from?: string | Date,
) {
  const customer = party === "customer";
  const partyId = customer
    ? Prisma.sql`entry.customer_id`
    : Prisma.sql`entry.supplier_id`;
  const billKind = customer ? "ORDER_SALE" : "ORDER_PURCHASE";
  const settlementKind = customer ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT";
  const closingDate =
    typeof asOf === "string" ? asOf : asOf.toISOString().slice(0, 10);
  const openingDate =
    from instanceof Date ? from.toISOString().slice(0, 10) : from;
  const start = openingDate
    ? Prisma.sql`AND entry.business_date >= ${openingDate}::date`
    : Prisma.empty;

  // Reversals repeat the linked revision. Use the posting direction rather than
  // amount sign because zero-priced dispatches still contribute trucks and weight.
  return Prisma.sql`
    SELECT ${partyId} AS "partyId",
      COALESCE(SUM(CASE WHEN entry.reverses_id IS NULL THEN 1 ELSE -1 END)
        FILTER (WHERE entry.kind = ${billKind}::ledger_entry_kind), 0) AS trucks,
      COALESCE(SUM(CASE WHEN entry.reverses_id IS NULL THEN revision.weight ELSE -revision.weight END)
        FILTER (WHERE entry.kind = ${billKind}::ledger_entry_kind), 0) AS weight,
      COALESCE(SUM(entry.amount) FILTER (WHERE entry.kind = ${billKind}::ledger_entry_kind), 0) AS billed,
      -COALESCE(SUM(entry.amount) FILTER (WHERE entry.kind = ${settlementKind}::ledger_entry_kind
        AND voucher.method <> 'ADJUSTMENT'), 0) AS settled,
      SUM(entry.amount) AS balance
    FROM ledger_entries AS entry
    JOIN (${matches}) AS matched ON matched.id = ${partyId}
    LEFT JOIN order_revisions AS revision ON revision.id = entry.order_revision_id
    LEFT JOIN payments AS voucher ON voucher.id = entry.payment_id
    WHERE entry.business_date <= ${closingDate}::date ${start}
    GROUP BY ${partyId}
  `;
}

export async function getPartyRollups(
  tx: Prisma.TransactionClient,
  party: Party,
  partyIds: readonly string[],
  asOf: string | Date = todayBusinessDate(),
  from?: string | Date,
): Promise<PartyRollup[]> {
  if (partyIds.length === 0) return [];
  const ids = Prisma.join(partyIds.map((id) => Prisma.sql`(${id}::uuid)`));
  const matches = Prisma.sql`SELECT DISTINCT id FROM (VALUES ${ids}) AS requested(id)`;
  const rows = await tx.$queryRaw<BigIntTrucks<PartyRollup>[]>(Prisma.sql`
    SELECT "partyId", trucks, weight::text, billed::text, settled::text, balance::text
    FROM (${partyLedgerRollupQuery(party, matches, asOf, from)}) AS rollup
  `);
  return rows.map((row) => ({ ...row, trucks: Number(row.trucks) }));
}

// matches is an internal parameterized SELECT that returns each matching UUID once.
export async function getPartyRollupTotals(
  tx: Prisma.TransactionClient,
  party: Party,
  matches: Prisma.Sql,
  asOf: string | Date = todayBusinessDate(),
): Promise<PartyRollupTotals> {
  const [row] = await tx.$queryRaw<
    BigIntTrucks<PartyRollupTotals>[]
  >(Prisma.sql`
    SELECT COALESCE(SUM(trucks), 0)::bigint AS trucks,
      COALESCE(SUM(weight), 0)::text AS weight,
      COALESCE(SUM(billed), 0)::text AS billed,
      COALESCE(SUM(settled), 0)::text AS settled,
      COALESCE(SUM(balance), 0)::text AS balance,
      COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::text AS due,
      (-COALESCE(SUM(balance) FILTER (WHERE balance < 0), 0))::text AS advance
    FROM (${partyLedgerRollupQuery(party, matches, asOf)}) AS rollup
  `);
  return { ...row, trucks: Number(row.trucks) };
}
