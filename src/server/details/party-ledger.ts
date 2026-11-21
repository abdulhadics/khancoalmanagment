import { Decimal } from "decimal.js";
import { z } from "zod";
import { todayBusinessDate } from "@/domain/business-date";
import {
  Prisma,
  type LedgerEntryKind,
  type PaymentMethod,
} from "@/generated/prisma/client";
import { getPartyRollups } from "../repositories/party-ledger-rollups";
import { resolveReportPeriod } from "../reporting/period";
import { readDocumentDisplayPreferences } from "../settings/company";

export type LedgerParty = "customer" | "supplier";
export type LedgerTab = "all" | "orders" | "payments";
export type LedgerSort =
  "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
export const ledgerPageSizes = [10, 20, 50, 100] as const;

type Query =
  URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

export type PartyLedgerFilters = {
  partyId?: string;
  year?: string;
  month?: string;
  from?: string;
  to?: string;
  period: { from?: string; to: string };
  q: string;
  tab: LedgerTab;
  sort: LedgerSort;
  page: number;
  pageSize: number;
};

function queryValue(query: Query, name: string) {
  const value =
    query instanceof URLSearchParams ? query.get(name) : query[name];
  return typeof value === "string" ? value : undefined;
}

export function parsePartyLedgerFilters(
  query: Query,
  now = new Date(),
  defaultSort: LedgerSort = "date-desc",
): PartyLedgerFilters {
  const get = (name: string) => queryValue(query, name)?.trim() || undefined;
  const requestedId = get("partyId");
  const partyId = z.uuid().safeParse(requestedId).success
    ? requestedId!.toLowerCase()
    : undefined;
  const inputPeriod = {
    year: get("year"),
    month: get("month"),
    from: get("from"),
    to: get("to"),
  };
  const period = resolveReportPeriod(inputPeriod, now);
  const q = (get("q") ?? "").slice(0, 120);
  const rawTab = get("tab");
  const rawSort = get("sort");
  const page = Number(get("page"));
  const pageSize = Number(get("pageSize"));
  return {
    partyId,
    ...inputPeriod,
    period: { ...period, to: period.to ?? todayBusinessDate(now) },
    q,
    tab: rawTab === "orders" || rawTab === "payments" ? rawTab : "all",
    sort:
      rawSort === "date-desc" ||
      rawSort === "date-asc" ||
      rawSort === "amount-desc" ||
      rawSort === "amount-asc"
        ? rawSort
        : defaultSort,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: ledgerPageSizes.find((size) => size === pageSize) ?? 20,
  };
}

export type LedgerPartyIdentity = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type PartyLedgerRow = {
  id: string;
  businessDate: string;
  refNo: string | null;
  kind: LedgerEntryKind;
  isReversal: boolean;
  partyName: string;
  orderId: string | null;
  paymentId: string | null;
  paymentMethod: PaymentMethod | null;
  vehicleOrBank: string | null;
  mineOrReference: string | null;
  weight: string | null;
  rate: string | null;
  debit: string;
  credit: string;
  balance: string;
  canPrintOrder: boolean;
};

function partyTable(kind: LedgerParty) {
  return kind === "customer" ? Prisma.sql`customers` : Prisma.sql`suppliers`;
}

export function readLedgerPartyChoices(
  tx: Prisma.TransactionClient,
  kind: LedgerParty,
) {
  return tx.$queryRaw<LedgerPartyIdentity[]>(Prisma.sql`
    SELECT id, code, name, is_active AS "isActive"
    FROM ${partyTable(kind)} ORDER BY name_key, id
  `);
}

const exact = Decimal.clone({ precision: 40 });

async function readPeriodActivity(
  tx: Prisma.TransactionClient,
  kind: LedgerParty,
  partyId: string,
  period: PartyLedgerFilters["period"],
) {
  const partyColumn =
    kind === "customer"
      ? Prisma.sql`entry.customer_id`
      : Prisma.sql`entry.supplier_id`;
  const before = period.from
    ? Prisma.sql`entry.business_date < ${period.from}::date`
    : Prisma.sql`FALSE`;
  const start = period.from
    ? Prisma.sql`AND entry.business_date >= ${period.from}::date`
    : Prisma.empty;
  const [[periodTotals], [activity]] = await Promise.all([
    tx.$queryRaw<{ openingBalance: string; entryCount: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(entry.amount) FILTER (WHERE ${before}), 0)::text AS "openingBalance",
        COUNT(*) FILTER (WHERE TRUE ${start}) AS "entryCount"
      FROM ledger_entries AS entry
      WHERE ${partyColumn} = ${partyId}::uuid AND entry.business_date <= ${period.to}::date
    `),
    getPartyRollups(tx, kind, [partyId], period.to, period.from),
  ]);
  const openingBalance = new exact(periodTotals.openingBalance);
  const movement = new exact(activity?.balance ?? "0");
  const billed = new exact(activity?.billed ?? "0");
  const settled = new exact(activity?.settled ?? "0");
  const closingBalance = openingBalance.plus(movement);
  return {
    openingBalance: openingBalance.toFixed(2),
    closingBalance: closingBalance.toFixed(2),
    billed: billed.toFixed(2),
    settled: settled.toFixed(2),
    adjustments: movement.minus(billed).plus(settled).toFixed(2),
    activity: movement.toFixed(2),
    weight: new exact(activity?.weight ?? "0").toFixed(3),
    trucks: activity?.trucks ?? 0,
    entryCount: Number(periodTotals.entryCount),
    pending: exact.max(closingBalance, 0).toFixed(2),
    advance: exact.max(closingBalance.negated(), 0).toFixed(2),
  };
}

const ledgerSort = {
  "date-desc": Prisma.sql`line.business_date DESC, line.id DESC`,
  "date-asc": Prisma.sql`line.business_date ASC, line.id ASC`,
  "amount-desc": Prisma.sql`line.amount DESC, line.business_date DESC, line.id DESC`,
  "amount-asc": Prisma.sql`line.amount ASC, line.business_date DESC, line.id DESC`,
} satisfies Record<LedgerSort, Prisma.Sql>;

async function readLedgerLines(
  tx: Prisma.TransactionClient,
  kind: LedgerParty,
  party: LedgerPartyIdentity,
  filters: PartyLedgerFilters,
  openingBalance: string,
  exportLimit?: number,
) {
  const { period, q } = filters;
  const customer = kind === "customer";
  const partyColumn = customer
    ? Prisma.sql`entry.customer_id`
    : Prisma.sql`entry.supplier_id`;
  const rateColumn = customer
    ? Prisma.sql`revision.sell_rate`
    : Prisma.sql`revision.purchase_rate`;
  const start = period.from
    ? Prisma.sql`AND entry.business_date >= ${period.from}::date`
    : Prisma.empty;
  const search = q.toLowerCase();
  const tab =
    filters.tab === "orders"
      ? Prisma.sql`AND line.order_revision_id IS NOT NULL`
      : filters.tab === "payments"
        ? Prisma.sql`AND line.payment_id IS NOT NULL`
        : Prisma.empty;
  const source = Prisma.sql`
    WITH chronological AS (
      SELECT entry.*,
        ${openingBalance}::numeric + SUM(entry.amount) OVER (
          ORDER BY entry.business_date, entry.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_balance
      FROM ledger_entries AS entry
      WHERE ${partyColumn} = ${party.id}::uuid AND entry.business_date <= ${period.to}::date ${start}
    )
  `;
  // The search and tab filters run after the window. Display sorting never
  // changes a row's historical balance or omits its earlier hidden activity.
  const matching = Prisma.sql`
    FROM chronological AS line
    LEFT JOIN order_revisions AS revision ON revision.id = line.order_revision_id
    LEFT JOIN orders AS dispatch ON dispatch.id = revision.order_id
    LEFT JOIN mines AS mine ON mine.id = revision.mine_id
    LEFT JOIN payments AS voucher ON voucher.id = line.payment_id
    WHERE TRUE ${tab}
      AND (${search} = '' OR strpos(lower(concat_ws(' ', dispatch.order_no, revision.vehicle_no, revision.bilty_no,
        mine.code, voucher.voucher_no, voucher.bank_name, voucher.reference_no, ${party.name}::text)), ${search}) > 0)
  `;
  const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`${source} SELECT COUNT(*) AS count ${matching}`,
  );
  const matchedCount = Number(count);
  const lastPage = Math.max(1, Math.ceil(matchedCount / filters.pageSize));
  const page = exportLimit === undefined ? Math.min(filters.page, lastPage) : 1;
  const rows = matchedCount
    ? await tx.$queryRaw<PartyLedgerRow[]>(Prisma.sql`
    ${source}
    SELECT line.id::text, to_char(line.business_date, 'YYYY-MM-DD') AS "businessDate",
      COALESCE(dispatch.order_no, voucher.voucher_no) AS "refNo", line.kind,
      line.reverses_id IS NOT NULL AS "isReversal", ${party.name}::text AS "partyName",
      dispatch.id AS "orderId", voucher.id AS "paymentId",
      voucher.method AS "paymentMethod",
      COALESCE(revision.vehicle_no, voucher.bank_name) AS "vehicleOrBank",
      COALESCE(mine.code, voucher.reference_no) AS "mineOrReference",
      (CASE WHEN line.reverses_id IS NULL THEN revision.weight ELSE -revision.weight END)::text AS weight,
      ${rateColumn}::text AS rate,
      GREATEST(line.amount, 0)::text AS debit, GREATEST(-line.amount, 0)::text AS credit,
      line.running_balance::text AS balance,
      (dispatch.id IS NOT NULL AND dispatch.status <> 'VOIDED' AND line.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger_entries AS correction WHERE correction.reverses_id = line.id)) AS "canPrintOrder"
    ${matching}
    ORDER BY ${ledgerSort[filters.sort]}
    LIMIT ${exportLimit ?? filters.pageSize} OFFSET ${(page - 1) * filters.pageSize}
  `)
    : [];
  return { rows, page, lastPage, matchedCount };
}

export async function readPartyLedger(
  tx: Prisma.TransactionClient,
  kind: LedgerParty,
  filters: PartyLedgerFilters,
  exportLimit?: number,
) {
  if (!filters.partyId) return null;
  const [party] = await tx.$queryRaw<LedgerPartyIdentity[]>(Prisma.sql`
    SELECT id, code, name, is_active AS "isActive" FROM ${partyTable(kind)} WHERE id = ${filters.partyId}::uuid
  `);
  if (!party) return null;
  const [summary, preferences] = await Promise.all([
    readPeriodActivity(tx, kind, party.id, filters.period),
    readDocumentDisplayPreferences(tx),
  ]);
  const lines = await readLedgerLines(
    tx,
    kind,
    party,
    filters,
    summary.openingBalance,
    exportLimit,
  );
  return { party, summary, filters, preferences, ...lines };
}
