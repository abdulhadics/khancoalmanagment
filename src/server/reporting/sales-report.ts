import { z } from "zod";

import { requirePermission } from "../../domain/permissions";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { LivePrincipal } from "../auth/live-principal";
import { parseSalesFilters, SalesFiltersError } from "./sales-details";
import {
  signedSalesFacts,
  summedSalesMeasures,
  type SalesTotals,
} from "./sales-facts";

export const salesReportGroups = [
  "entry",
  "date",
  "customer",
  "supplier",
  "mine",
] as const;
export type SalesReportGroup = (typeof salesReportGroups)[number];

const groupInput = z.object({
  groupBy: z.enum(salesReportGroups).default("entry"),
});

export function parseSalesReportFilters(raw: unknown = {}) {
  const grouped = groupInput.safeParse(raw);
  if (!grouped.success) throw new SalesFiltersError("groupBy");
  const {
    year,
    month,
    from,
    to,
    customerId,
    supplierId,
    period,
    page,
    pageSize,
  } = parseSalesFilters(raw);
  return {
    year,
    month,
    from,
    to,
    customerId,
    supplierId,
    period,
    page,
    pageSize,
    ...grouped.data,
  };
}

export type SalesReportFilters = ReturnType<typeof parseSalesReportFilters>;

export function salesReportParameters(filters: SalesReportFilters) {
  const result = new URLSearchParams({
    groupBy: filters.groupBy,
    pageSize: String(filters.pageSize),
  });
  for (const field of [
    "year",
    "month",
    "from",
    "to",
    "customerId",
    "supplierId",
  ] as const) {
    const value = filters[field];
    if (value) result.set(field, value);
  }
  return result;
}

export type SalesReportRow = SalesTotals & {
  key: string;
  label: string;
  businessDate: string | null;
  customer: string | null;
  supplier: string | null;
  mine: string | null;
  vehicleNo: string | null;
};

const groupColumns = {
  entry: Prisma.sql`facts.order_id`,
  date: Prisma.sql`facts.business_date`,
  customer: Prisma.sql`facts.customer_id`,
  supplier: Prisma.sql`facts.supplier_id`,
  mine: Prisma.sql`facts.mine_id`,
} satisfies Record<SalesReportGroup, Prisma.Sql>;

const groupPresentation = {
  entry: {
    join: Prisma.sql`
      JOIN orders AS dispatch ON dispatch.id = grouped.key
      JOIN customers AS c ON c.id = dispatch.customer_id
      JOIN suppliers AS s ON s.id = dispatch.supplier_id
      JOIN mines AS m ON m.id = dispatch.mine_id AND m.supplier_id = dispatch.supplier_id
    `,
    fields: Prisma.sql`
      dispatch.order_no AS label,
      to_char(dispatch.business_date, 'YYYY-MM-DD') AS "businessDate",
      c.name AS customer, s.name AS supplier, m.code AS mine,
      dispatch.vehicle_no AS "vehicleNo"
    `,
    order: Prisma.sql`dispatch.business_date DESC, dispatch.number_year DESC, dispatch.ordinal DESC, grouped.key DESC`,
  },
  date: {
    join: Prisma.empty,
    fields: Prisma.sql`
      to_char(grouped.key, 'YYYY-MM-DD') AS label,
      to_char(grouped.key, 'YYYY-MM-DD') AS "businessDate",
      NULL::text AS customer, NULL::text AS supplier, NULL::text AS mine, NULL::text AS "vehicleNo"
    `,
    order: Prisma.sql`grouped.key DESC`,
  },
  customer: {
    join: Prisma.sql`JOIN customers AS c ON c.id = grouped.key`,
    fields: Prisma.sql`
      c.name AS label, NULL::text AS "businessDate",
      c.name AS customer, NULL::text AS supplier, NULL::text AS mine, NULL::text AS "vehicleNo"
    `,
    order: Prisma.sql`c.name_key, grouped.key`,
  },
  supplier: {
    join: Prisma.sql`JOIN suppliers AS s ON s.id = grouped.key`,
    fields: Prisma.sql`
      s.name AS label, NULL::text AS "businessDate",
      NULL::text AS customer, s.name AS supplier, NULL::text AS mine, NULL::text AS "vehicleNo"
    `,
    order: Prisma.sql`s.name_key, grouped.key`,
  },
  mine: {
    join: Prisma.sql`
      JOIN mines AS m ON m.id = grouped.key
      JOIN suppliers AS s ON s.id = m.supplier_id
    `,
    fields: Prisma.sql`
      concat_ws(' · ', m.code, m.name, s.name) AS label, NULL::text AS "businessDate",
      NULL::text AS customer, s.name AS supplier, m.code AS mine, NULL::text AS "vehicleNo"
    `,
    order: Prisma.sql`s.name_key, m.code_key, grouped.key`,
  },
} satisfies Record<
  SalesReportGroup,
  { join: Prisma.Sql; fields: Prisma.Sql; order: Prisma.Sql }
>;

type ResultPayload = Omit<SalesTotals, "trucks"> & {
  trucks: bigint;
  total: bigint;
  page: bigint;
  pages: bigint;
  rows: SalesReportRow[];
};

async function querySalesReport(
  tx: Prisma.TransactionClient,
  filters: SalesReportFilters,
  size: number,
  requestedPage: number,
) {
  const column = groupColumns[filters.groupBy];
  const presentation = groupPresentation[filters.groupBy];
  const facts = signedSalesFacts({
    ...filters.period,
    customerId: filters.customerId,
    supplierId: filters.supplierId,
  });

  // One materialized grouping supplies the count, full totals, and selected
  // rows. DECIMAL values become text before JSON encoding the page.
  const [result] = await tx.$queryRaw<ResultPayload[]>`
    WITH grouped AS MATERIALIZED (
      SELECT ${column} AS key, SUM(trucks) AS trucks, SUM(weight) AS weight,
        SUM(sales) AS sales, SUM(purchases) AS purchases
      FROM (${facts}) AS facts
      GROUP BY ${column}
      HAVING SUM(trucks) <> 0 OR SUM(weight) <> 0 OR SUM(sales) <> 0 OR SUM(purchases) <> 0
    ), totals AS (
      SELECT COUNT(*) AS total, ${summedSalesMeasures}
      FROM grouped
    ), paging AS (
      SELECT total, greatest(1, (total + ${size - 1}::bigint) / ${size}::bigint) AS pages
      FROM totals
    ), bounded AS (
      SELECT pages, least(pages, ${requestedPage}::bigint) AS page FROM paging
    )
    SELECT totals.*, bounded.*,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(result_row) - 'sortOrdinal' ORDER BY result_row."sortOrdinal")
        FROM (
          SELECT grouped.key::text AS key, ${presentation.fields},
            grouped.trucks AS trucks, grouped.weight::text AS weight,
            grouped.sales::text AS sales, grouped.purchases::text AS purchases,
            (grouped.sales - grouped.purchases)::text AS profit,
            row_number() OVER (ORDER BY ${presentation.order}) AS "sortOrdinal"
          FROM grouped ${presentation.join}
          ORDER BY ${presentation.order}
          LIMIT ${size} OFFSET (SELECT (page - 1) * ${size} FROM bounded)
        ) AS result_row
      ), '[]'::jsonb) AS rows
    FROM totals CROSS JOIN bounded
  `;
  if (!result) throw new Error("Sales reporting query returned no result.");

  const { total, page, pages, rows, trucks, ...amounts } = result;
  return {
    total: Number(total),
    page: Number(page),
    pages: Number(pages),
    rows,
    totals: { ...amounts, trucks: Number(trucks) },
    filters,
  };
}

export async function readSalesReportPage(
  database: PrismaClient,
  actor: LivePrincipal,
  raw: unknown = {},
) {
  requirePermission(actor, "reports.view");
  const filters = parseSalesReportFilters(raw);
  return querySalesReport(database, filters, filters.pageSize, filters.page);
}

export async function readSalesReportExport(
  tx: Prisma.TransactionClient,
  actor: LivePrincipal,
  raw: unknown,
  limit: number,
) {
  requirePermission(actor, "reports.export");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Invalid report export limit.");
  return querySalesReport(tx, parseSalesReportFilters(raw), limit, 1);
}

export async function readSalesReportOptions(
  database: PrismaClient,
  actor: LivePrincipal,
) {
  requirePermission(actor, "reports.view");
  return Promise.all([
    database.customer.findMany({
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    database.supplier.findMany({
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);
}
