import { z } from "zod";

import { requirePermission } from "../../domain/permissions";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { LivePrincipal } from "../auth/live-principal";
import { businessDateConditions, resolveReportPeriod } from "./period";
import { readSalesSummary } from "./sales-facts";

export const salesSortColumns = [
  "orderNo",
  "businessDate",
  "customer",
  "supplier",
  "mine",
  "vehicleNo",
  "weight",
  "purchaseRate",
  "buyAmount",
  "sellRate",
  "sellAmount",
  "profit",
] as const;

export type SalesSortColumn = (typeof salesSortColumns)[number];

const sortSql = {
  orderNo: Prisma.sql`o.number_year, o.ordinal`,
  businessDate: Prisma.sql`o.business_date`,
  customer: Prisma.sql`c.name_key`,
  supplier: Prisma.sql`s.name_key`,
  mine: Prisma.sql`m.code_key`,
  vehicleNo: Prisma.sql`o.vehicle_no`,
  weight: Prisma.sql`revision.weight`,
  purchaseRate: Prisma.sql`revision.purchase_rate`,
  buyAmount: Prisma.sql`revision.buy_amount`,
  sellRate: Prisma.sql`revision.sell_rate`,
  sellAmount: Prisma.sql`revision.sell_amount`,
  profit: Prisma.sql`revision.profit`,
} satisfies Record<SalesSortColumn, Prisma.Sql>;

export const salesPageSizes = [10, 25, 50, 100] as const;

const optionalText = z.string().trim().max(64).optional();
const optionalParty = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const filterInput = z.object({
  year: optionalText,
  month: optionalText,
  from: optionalText,
  to: optionalText,
  customerId: optionalParty,
  supplierId: optionalParty,
  q: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !value.includes("\0"))
    .default(""),
  sort: z.enum(salesSortColumns).default("businessDate"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(50_000).default(1),
  pageSize: z.coerce.number().pipe(z.literal(salesPageSizes)).default(25),
});

export class SalesFiltersError extends Error {
  constructor(readonly field?: string) {
    super("Invalid sales filters.");
    this.name = "SalesFiltersError";
  }
}

export function parseSalesFilters(raw: unknown = {}, now = new Date()) {
  const parsed = filterInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new SalesFiltersError(typeof field === "string" ? field : undefined);
  }
  return { ...parsed.data, period: resolveReportPeriod(parsed.data, now) };
}

export type SalesFilters = ReturnType<typeof parseSalesFilters>;

export function salesFilterParameters(filters: SalesFilters) {
  const params = new URLSearchParams({
    sort: filters.sort,
    direction: filters.direction,
    pageSize: String(filters.pageSize),
  });
  for (const key of [
    "year",
    "month",
    "from",
    "to",
    "customerId",
    "supplierId",
    "q",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params;
}

export type SalesDetailsRow = {
  id: string;
  orderNo: string;
  businessDate: string;
  customer: string;
  supplier: string;
  mine: string;
  vehicleNo: string;
  biltyNo: string | null;
  weight: string;
  purchaseRate: string;
  buyAmount: string;
  sellRate: string;
  sellAmount: string;
  profit: string;
  revisionNo: number;
};

const partyJoins = Prisma.sql`
  JOIN customers AS c ON c.id = o.customer_id
  JOIN suppliers AS s ON s.id = o.supplier_id
  JOIN mines AS m ON m.id = o.mine_id AND m.supplier_id = o.supplier_id
`;

function matchesOrders(filters: SalesFilters) {
  const conditions = [
    Prisma.sql`o.status = 'POSTED'`,
    ...businessDateConditions(Prisma.sql`o.business_date`, filters.period),
  ];
  if (filters.customerId)
    conditions.push(Prisma.sql`o.customer_id = ${filters.customerId}::uuid`);
  if (filters.supplierId)
    conditions.push(Prisma.sql`o.supplier_id = ${filters.supplierId}::uuid`);
  if (filters.q) {
    const term = filters.q.toLowerCase();
    conditions.push(Prisma.sql`(
      strpos(lower(o.order_no), ${term}) > 0
      OR strpos(c.name_key, ${term}) > 0
      OR strpos(s.name_key, ${term}) > 0
      OR strpos(m.code_key, ${term}) > 0
      OR strpos(lower(m.name), ${term}) > 0
      OR strpos(lower(o.vehicle_no), ${term}) > 0
      OR strpos(lower(coalesce(o.bilty_no, '')), ${term}) > 0
    )`);
  }
  return Prisma.join(conditions, " AND ");
}

async function orderCount(tx: Prisma.TransactionClient, filters: SalesFilters) {
  const joins = filters.q ? partyJoins : Prisma.empty;
  const [count] = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS total
    FROM orders AS o ${joins}
    WHERE ${matchesOrders(filters)}
  `;
  return Number(count?.total ?? 0n);
}

async function querySalesDetails(
  tx: Prisma.TransactionClient,
  filters: SalesFilters,
  limit: number,
  offset: number,
) {
  const direction =
    filters.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order =
    filters.sort === "orderNo"
      ? Prisma.sql`o.number_year ${direction}, o.ordinal ${direction}`
      : Prisma.sql`${sortSql[filters.sort]} ${direction}`;
  const rows = await tx.$queryRaw<SalesDetailsRow[]>`
    SELECT o.id, o.order_no AS "orderNo",
      to_char(o.business_date, 'YYYY-MM-DD') AS "businessDate",
      c.name AS customer, s.name AS supplier, m.code AS mine,
      o.vehicle_no AS "vehicleNo", o.bilty_no AS "biltyNo",
      revision.weight::text AS weight,
      revision.purchase_rate::text AS "purchaseRate",
      revision.buy_amount::text AS "buyAmount",
      revision.sell_rate::text AS "sellRate",
      revision.sell_amount::text AS "sellAmount",
      revision.profit::text AS profit,
      revision.revision_no AS "revisionNo"
    FROM orders AS o
    ${partyJoins}
    JOIN order_revisions AS revision
      ON revision.order_id = o.id AND revision.revision_no = o.current_revision_no
    WHERE ${matchesOrders(filters)}
    ORDER BY ${order}, o.id ${direction}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const totals = await readSalesSummary(tx, {
    ...filters.period,
    customerId: filters.customerId,
    supplierId: filters.supplierId,
    // Current metadata (such as vehicle) is searchable after an audited edit.
    // The matched order IDs still constrain the immutable financial postings.
    matchingOrders: filters.q
      ? Prisma.sql`SELECT o.id FROM orders AS o ${partyJoins} WHERE ${matchesOrders(filters)}`
      : undefined,
  });
  return { rows, totals };
}

export async function readSalesDetailsPage(
  database: PrismaClient,
  actor: LivePrincipal,
  raw: unknown = {},
) {
  requirePermission(actor, "details.view");
  const filters = parseSalesFilters(raw);
  return database.$transaction(
    async (tx) => {
      const total = await orderCount(tx, filters);
      const pages = Math.max(1, Math.ceil(total / filters.pageSize));
      const page = Math.min(filters.page, pages);
      return {
        ...(await querySalesDetails(
          tx,
          filters,
          filters.pageSize,
          (page - 1) * filters.pageSize,
        )),
        filters,
        total,
        page,
        pages,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function readSalesDetailsExport(
  tx: Prisma.TransactionClient,
  actor: LivePrincipal,
  raw: unknown,
  limit: number,
) {
  requirePermission(actor, "reports.export");
  requirePermission(actor, "details.view");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Invalid sales export limit.");
  const filters = parseSalesFilters(raw);
  const total = await orderCount(tx, filters);
  return {
    ...(await querySalesDetails(tx, filters, limit, 0)),
    filters,
    total,
  };
}
