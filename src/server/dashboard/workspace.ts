import { Decimal } from "decimal.js";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import {
  can,
  requirePermission,
  type PermissionActor,
} from "@/domain/permissions";
import { readTotalExpenses } from "../expenses/queries";
import {
  Prisma,
  type OrderStatus,
  type PaymentDirection,
  type PaymentStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getCashMovementTotals } from "../repositories/cash-movement";
import { getOutstandingBalances } from "../repositories/party-ledger-rollups";
import { businessDateConditions } from "../reporting/period";
import { readSalesTimeline, type SalesTotals } from "../reporting/sales-facts";
import { readDocumentDisplayPreferences } from "../settings/company";
import {
  chartMonths,
  parseDashboardFilters,
  type DashboardBounds,
  type DashboardFilters,
} from "./period";

export { DashboardPeriodError, dashboardPeriods } from "./period";

const activityLimit = 6;
const emptySales: SalesTotals = {
  trucks: 0,
  weight: "0.000",
  sales: "0.00",
  purchases: "0.00",
  profit: "0.00",
};

async function readRecentOrders(
  tx: Prisma.TransactionClient,
  actor: PermissionActor,
  bounds: DashboardBounds,
) {
  const conditions = businessDateConditions(
    Prisma.sql`dispatch.business_date`,
    bounds,
  );
  conditions.push(
    can(actor.roleCode, "orders.view")
      ? Prisma.sql`dispatch.status <> 'VOIDED'`
      : Prisma.sql`dispatch.status = 'POSTED'`,
  );
  if (actor.roleCode === "OPERATOR") {
    conditions.push(Prisma.sql`dispatch.created_by_id = ${actor.userId}::uuid`);
  }
  return tx.$queryRaw<
    Array<{
      id: string;
      orderNo: string;
      date: string;
      customerName: string;
      vehicleNo: string;
      weight: string;
      status: OrderStatus;
    }>
  >`
    SELECT dispatch.id, dispatch.order_no AS "orderNo", dispatch.status::text,
      to_char(dispatch.business_date, 'YYYY-MM-DD') AS date,
      dispatch.vehicle_no AS "vehicleNo", customer.name AS "customerName", revision.weight::text
    FROM orders AS dispatch
    JOIN customers AS customer ON customer.id = dispatch.customer_id
    JOIN order_revisions AS revision
      ON revision.order_id = dispatch.id AND revision.revision_no = dispatch.current_revision_no
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY dispatch.business_date DESC, dispatch.ordinal DESC
    LIMIT ${activityLimit}
  `;
}

async function readRecentTransactions(
  tx: Prisma.TransactionClient,
  bounds: DashboardBounds,
) {
  const conditions = businessDateConditions(
    Prisma.sql`voucher.business_date`,
    bounds,
  );
  return tx.$queryRaw<
    Array<{
      id: string;
      voucherNo: string;
      date: string;
      partyName: string;
      direction: PaymentDirection;
      amount: string;
      status: PaymentStatus;
    }>
  >`
    SELECT voucher.id, voucher.voucher_no AS "voucherNo",
      to_char(voucher.business_date, 'YYYY-MM-DD') AS date,
      COALESCE(customer.name, supplier.name) AS "partyName",
      voucher.direction::text, voucher.amount::text, voucher.status::text
    FROM payments AS voucher
    LEFT JOIN customers AS customer ON customer.id = voucher.customer_id
    LEFT JOIN suppliers AS supplier ON supplier.id = voucher.supplier_id
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY voucher.business_date DESC, voucher.ordinal DESC
    LIMIT ${activityLimit}
  `;
}

async function readDispatchDashboard(
  tx: Prisma.TransactionClient,
  actor: PermissionActor,
  today: string,
) {
  const where = {
    createdById: actor.userId,
    businessDate: parseBusinessDate(today),
    status: { not: "VOIDED" },
  } satisfies Prisma.OrderWhereInput;
  const bounds = { from: today, to: today };
  const [measures, recentOrders, preferences] = await Promise.all([
    tx.orderRevision.aggregate({
      where: { currentFor: { some: where } },
      _count: true,
      _sum: { weight: true },
    }),
    readRecentOrders(tx, actor, bounds),
    readDocumentDisplayPreferences(tx),
  ]);
  return {
    scope: "dispatch" as const,
    today,
    period: "today" as const,
    bounds,
    totals: {
      trucks: measures._count,
      weight: measures._sum.weight?.toFixed(3) ?? emptySales.weight,
    },
    recentOrders,
    preferences,
  };
}

async function readFinancialDashboard(
  tx: Prisma.TransactionClient,
  actor: PermissionActor,
  filters: ReturnType<typeof parseDashboardFilters>,
) {
  requirePermission(actor, "dashboard.financial");
  const { today, period, bounds, presets } = filters;
  const months = chartMonths(bounds.to);
  const windows = [
    ["selected", bounds],
    ["today", presets.today],
    ["month", presets.month],
    ["year", presets.year],
    ["all", presets.all],
  ] as const;
  const [
    timeline,
    cash,
    balances,
    companyCounts,
    recentOrders,
    transactions,
    preferences,
    totalExpenses,
  ] = await Promise.all([
    readSalesTimeline(tx, windows, { from: `${months[0]}-01`, to: bounds.to }),
    getCashMovementTotals(tx, { from: bounds.from, through: bounds.to }),
    getOutstandingBalances(tx, bounds.to),
    tx.customer.groupBy({ by: ["isActive"], _count: true }),
    readRecentOrders(tx, actor, bounds),
    can(actor.roleCode, "account.view")
      ? readRecentTransactions(tx, bounds)
      : null,
    readDocumentDisplayPreferences(tx),
    readTotalExpenses(tx, bounds),
  ]);
  function totalsFor(key: (typeof windows)[number][0]) {
    const totals = timeline.totals.get(key);
    if (!totals) throw new Error("Dashboard sales window is missing.");
    return totals;
  }
  const selectedTotals = totalsFor("selected");
  const netProfit = new Decimal(selectedTotals.profit)
    .minus(totalExpenses)
    .toFixed(2);
  return {
    scope: "financial" as const,
    today,
    period,
    bounds,
    totals: selectedTotals,
    summary: {
      today: totalsFor("today"),
      month: totalsFor("month"),
      year: totalsFor("year"),
      all: totalsFor("all"),
    },
    monthly: months.map((month) => ({
      ...(timeline.months.get(month) ?? emptySales),
      month,
    })),
    cash,
    companies: {
      active: companyCounts.find(({ isActive }) => isActive)?._count ?? 0,
      total: companyCounts.reduce((total, row) => total + row._count, 0),
    },
    balances,
    expenses: totalExpenses,
    netProfit,
    recentOrders,
    transactions,
    preferences,
  };
}

export async function readDashboard(
  database: PrismaClient,
  actor: PermissionActor,
  filters: DashboardFilters = {},
  now = new Date(),
) {
  requirePermission(actor, "dashboard.view");
  return database.$transaction(
    async (tx) =>
      actor.roleCode === "OPERATOR"
        ? readDispatchDashboard(tx, actor, todayBusinessDate(now))
        : readFinancialDashboard(
            tx,
            actor,
            parseDashboardFilters(filters, now),
          ),
    { isolationLevel: "RepeatableRead" },
  );
}
