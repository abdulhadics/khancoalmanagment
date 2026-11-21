import Decimal from "decimal.js";
import { requirePermission } from "@/domain/permissions";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  requireLivePermission,
  type LivePrincipal,
} from "@/server/auth/live-principal";
import {
  parsePartySummaryFilters,
  readPartySummaryReport,
  type PartySummaryFilters,
} from "@/server/reporting/party-summary";
import { readAccountingIntegrity } from "@/server/reporting/reconciliation";

const permission = "admin.integrity";
const exact = Decimal.clone({ precision: 40 });

export function parseIntegrityPeriod(
  query: Record<string, string | string[] | undefined>,
) {
  return parsePartySummaryFilters({ from: query.from, to: query.to });
}

async function reconcilePartyReport(
  tx: Prisma.TransactionClient,
  party: "customer" | "supplier",
  filters: PartySummaryFilters,
) {
  const { from, to } = filters.period;
  const before = from
    ? Prisma.sql`business_date < ${from}::date`
    : Prisma.sql`FALSE`;
  const partyColumn =
    party === "customer" ? Prisma.sql`customer_id` : Prisma.sql`supplier_id`;
  const [report, [journal]] = await Promise.all([
    readPartySummaryReport(tx, party, filters),
    tx.$queryRaw<{ opening: string; closing: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount) FILTER (WHERE ${before}), 0)::text AS opening,
        COALESCE(SUM(amount), 0)::text AS closing
      FROM ledger_entries
      WHERE ${partyColumn} IS NOT NULL AND business_date <= ${to}::date
    `),
  ]);
  const { totals } = report;
  const reconstructed = new exact(journal.opening)
    .plus(totals.billed)
    .minus(totals.settled)
    .plus(totals.adjustments);

  return {
    party,
    preferences: report.preferences,
    opening: new exact(journal.opening).toFixed(2),
    billed: totals.billed,
    settled: totals.settled,
    adjustments: totals.adjustments,
    closing: new exact(journal.closing).toFixed(2),
    reportedClosing: totals.closingBalance,
    matches:
      reconstructed.equals(journal.closing) &&
      reconstructed.equals(totals.closingBalance) &&
      new exact(journal.opening).equals(totals.openingBalance),
  };
}

export async function runAdminIntegrityCheck(
  database: PrismaClient,
  actor: LivePrincipal,
  filters: PartySummaryFilters,
) {
  requirePermission(actor, permission);
  return database.$transaction(
    async (tx) => {
      await requireLivePermission(tx, actor, permission);
      const [accounting, customers, suppliers] = await Promise.all([
        readAccountingIntegrity(tx, actor),
        reconcilePartyReport(tx, "customer", filters),
        reconcilePartyReport(tx, "supplier", filters),
      ]);
      return { accounting, balances: [customers, suppliers] };
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}
