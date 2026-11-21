import { Prisma } from "@/generated/prisma/client";
import {
  parsePartyLedgerFilters,
  type LedgerParty,
  type LedgerPartyIdentity,
  type PartyLedgerFilters,
} from "../details/party-ledger";
import { partyLedgerRollupQuery } from "../repositories/party-ledger-rollups";
import { readDocumentDisplayPreferences } from "../settings/company";

type ReportQuery = Parameters<typeof parsePartyLedgerFilters>[0];
export type PartySummaryFilters = Pick<
  PartyLedgerFilters,
  "period" | "year" | "month" | "from" | "to" | "q" | "page" | "pageSize"
>;

export function parsePartySummaryFilters(
  query: ReportQuery,
  now = new Date(),
): PartySummaryFilters {
  const { period, year, month, from, to, q, page, pageSize } =
    parsePartyLedgerFilters(query, now);
  return { period, year, month, from, to, q, page, pageSize };
}

export function parseSinglePartyReportFilters(
  query: ReportQuery,
  now = new Date(),
) {
  return parsePartyLedgerFilters(query, now, "date-asc");
}

export type PartySummaryMetrics = {
  trucks: number;
  weight: string;
  openingBalance: string;
  billed: string;
  settled: string;
  adjustments: string;
  activity: string;
  closingBalance: string;
  pending: string;
  advance: string;
};

export type PartySummaryRow = LedgerPartyIdentity & PartySummaryMetrics;

type RawMetrics<T extends PartySummaryMetrics> = Omit<T, "trucks"> & {
  trucks: bigint;
};

function partyReportScope(
  party: LedgerParty,
  partySelection: Prisma.Sql,
  period: PartySummaryFilters["period"],
) {
  const partyColumn =
    party === "customer"
      ? Prisma.sql`entry.customer_id`
      : Prisma.sql`entry.supplier_id`;
  const datesBefore = period.from
    ? Prisma.sql`entry.business_date < ${period.from}::date`
    : Prisma.sql`FALSE`;

  return Prisma.sql`
    WITH selected AS (${partySelection}),
    prior AS (
      SELECT ${partyColumn} AS id, SUM(entry.amount) AS opening
      FROM ledger_entries AS entry JOIN selected ON selected.id = ${partyColumn}
      WHERE ${datesBefore}
      GROUP BY ${partyColumn}
    ),
    activity AS (${partyLedgerRollupQuery(party, Prisma.sql`SELECT id FROM selected`, period.to, period.from)}),
    balances AS (
      SELECT selected.*, COALESCE(activity.trucks, 0) AS trucks,
        COALESCE(activity.weight, 0) AS weight,
        COALESCE(prior.opening, 0) AS opening,
        COALESCE(activity.billed, 0) AS billed,
        COALESCE(activity.settled, 0) AS settled,
        COALESCE(activity.balance - activity.billed + activity.settled, 0) AS adjustments,
        COALESCE(activity.balance, 0) AS movement,
        COALESCE(prior.opening, 0) + COALESCE(activity.balance, 0) AS closing
      FROM selected LEFT JOIN prior ON selected.id = prior.id
      LEFT JOIN activity ON selected.id = activity."partyId"
    )
  `;
}

export async function readPartySummaryReport(
  tx: Prisma.TransactionClient,
  kind: LedgerParty,
  filters: PartySummaryFilters,
  exportLimit?: number,
) {
  const table =
    kind === "customer" ? Prisma.sql`customers` : Prisma.sql`suppliers`;
  const search = filters.q.toLowerCase();
  const lookup = Prisma.sql`
    FROM ${table} AS party
    WHERE (${search} = '' OR strpos(party.name_key, ${search}) > 0 OR strpos(lower(party.code), ${search}) > 0)
  `;
  const selection = Prisma.sql`SELECT party.id, party.code, party.name, party.name_key, party.is_active ${lookup}`;
  const scope = partyReportScope(kind, selection, filters.period);
  const [[total], preferences] = await Promise.all([
    tx.$queryRaw<
      Array<RawMetrics<PartySummaryMetrics> & { partyCount: bigint }>
    >(Prisma.sql`
      ${scope}
      SELECT COUNT(*) AS "partyCount", COALESCE(SUM(trucks), 0)::bigint AS trucks,
        ROUND(COALESCE(SUM(weight), 0), 3)::text AS weight,
        ROUND(COALESCE(SUM(opening), 0), 2)::text AS "openingBalance",
        ROUND(COALESCE(SUM(billed), 0), 2)::text AS billed,
        ROUND(COALESCE(SUM(settled), 0), 2)::text AS settled,
        ROUND(COALESCE(SUM(adjustments), 0), 2)::text AS adjustments,
        ROUND(COALESCE(SUM(movement), 0), 2)::text AS activity,
        ROUND(COALESCE(SUM(closing), 0), 2)::text AS "closingBalance",
        ROUND(COALESCE(SUM(GREATEST(closing, 0)), 0), 2)::text AS pending,
        ROUND(COALESCE(SUM(GREATEST(-closing, 0)), 0), 2)::text AS advance
      FROM balances
    `),
    readDocumentDisplayPreferences(tx),
  ]);
  const { partyCount, ...values } = total;
  const matchedCount = Number(partyCount);
  const lastPage = Math.max(1, Math.ceil(matchedCount / filters.pageSize));
  const page = exportLimit === undefined ? Math.min(filters.page, lastPage) : 1;
  const pageSelection = Prisma.sql`${selection} ORDER BY party.name_key, party.id LIMIT ${exportLimit ?? filters.pageSize} OFFSET ${(page - 1) * filters.pageSize}`;
  const rows = matchedCount
    ? await tx.$queryRaw<RawMetrics<PartySummaryRow>[]>(Prisma.sql`
    ${partyReportScope(kind, pageSelection, filters.period)}
    SELECT id, code, name, is_active AS "isActive", trucks,
      ROUND(weight, 3)::text AS weight,
      ROUND(opening, 2)::text AS "openingBalance",
      ROUND(billed, 2)::text AS billed,
      ROUND(settled, 2)::text AS settled,
      ROUND(adjustments, 2)::text AS adjustments,
      ROUND(movement, 2)::text AS activity,
      ROUND(closing, 2)::text AS "closingBalance",
      ROUND(GREATEST(closing, 0), 2)::text AS pending,
      ROUND(GREATEST(-closing, 0), 2)::text AS advance
    FROM balances ORDER BY name_key, id
  `)
    : [];
  const totals: PartySummaryMetrics = {
    ...values,
    trucks: Number(values.trucks),
  };
  return {
    filters,
    preferences,
    totals,
    rows: rows.map((row) => ({ ...row, trucks: Number(row.trucks) })),
    page,
    lastPage,
    matchedCount,
  };
}
