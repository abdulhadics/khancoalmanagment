import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import {
  can,
  requirePermission,
  type PermissionActor,
} from "@/domain/permissions";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getCashMovementTotals } from "../repositories/cash-movement";
import { getPartyRollupTotals } from "../repositories/party-ledger-rollups";
import {
  readMonthlySales,
  readSalesSummary,
  type SalesTotals,
} from "../reporting/sales-facts";
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

function dateRange({ from, to }: DashboardBounds) {
  return {
    gte: from ? parseBusinessDate(from) : undefined,
    lte: parseBusinessDate(to),
  };
}

async function readRecentOrders(
  tx: Prisma.TransactionClient,
  where: Prisma.OrderWhereInput,
) {
  const orders = await tx.order.findMany({
    where,
    orderBy: [{ businessDate: "desc" }, { ordinal: "desc" }],
    take: activityLimit,
    select: {
      id: true,
      orderNo: true,
      businessDate: true,
      vehicleNo: true,
      status: true,
      customer: { select: { name: true } },
      currentRevision: { select: { weight: true } },
    },
  });
  return orders.map(({ businessDate, customer, currentRevision, ...order }) => {
    if (!currentRevision) throw new Error("Dispatch revision is missing.");
    return {
      ...order,
      date: businessDate.toISOString().slice(0, 10),
      customerName: customer.name,
      weight: currentRevision.weight.toFixed(3),
    };
  });
}

async function readRecentTransactions(
  tx: Prisma.TransactionClient,
  bounds: DashboardBounds,
) {
  const vouchers = await tx.payment.findMany({
    where: { businessDate: dateRange(bounds) },
    orderBy: [{ businessDate: "desc" }, { ordinal: "desc" }],
    take: activityLimit,
    select: {
      id: true,
      voucherNo: true,
      businessDate: true,
      direction: true,
      amount: true,
      status: true,
      customer: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });
  return vouchers.map(
    ({ businessDate, customer, supplier, amount, ...voucher }) => {
      const party = customer ?? supplier;
      if (!party) throw new Error("Voucher is missing its issued party.");
      return {
        ...voucher,
        date: businessDate.toISOString().slice(0, 10),
        partyName: party.name,
        amount: amount.toFixed(2),
      };
    },
  );
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
  const [measures, recentOrders, preferences] = await Promise.all([
    tx.orderRevision.aggregate({
      where: { currentFor: { some: where } },
      _count: true,
      _sum: { weight: true },
    }),
    readRecentOrders(tx, where),
    readDocumentDisplayPreferences(tx),
  ]);
  return {
    scope: "dispatch" as const,
    today,
    period: "today" as const,
    bounds: { from: today, to: today },
    totals: {
      trucks: measures._count,
      weight: measures._sum.weight?.toFixed(3) ?? emptySales.weight,
    },
    recentOrders,
    preferences,
  };
}

function readSummaries(
  tx: Prisma.TransactionClient,
  { bounds, presets }: ReturnType<typeof parseDashboardFilters>,
) {
  const selected = readSalesSummary(tx, bounds);
  const summary = (range: DashboardBounds) =>
    range.from === bounds.from && range.to === bounds.to
      ? selected
      : readSalesSummary(tx, range);
  return Promise.all([
    selected,
    summary(presets.today),
    summary(presets.month),
    summary(presets.year),
    summary(presets.all),
  ]);
}

async function readFinancialDashboard(
  tx: Prisma.TransactionClient,
  actor: PermissionActor,
  filters: ReturnType<typeof parseDashboardFilters>,
) {
  requirePermission(actor, "dashboard.financial");
  const { today, period, bounds } = filters;
  const months = chartMonths(bounds.to);
  const [
    [totals, todayTotals, month, year, all],
    monthlySales,
    cash,
    customers,
    suppliers,
    companyCounts,
    recentOrders,
    transactions,
    preferences,
  ] = await Promise.all([
    readSummaries(tx, filters),
    readMonthlySales(tx, { from: `${months[0]}-01`, to: bounds.to }),
    getCashMovementTotals(tx, { from: bounds.from, through: bounds.to }),
    getPartyRollupTotals(
      tx,
      "customer",
      Prisma.sql`SELECT id FROM customers`,
      bounds.to,
    ),
    getPartyRollupTotals(
      tx,
      "supplier",
      Prisma.sql`SELECT id FROM suppliers`,
      bounds.to,
    ),
    tx.customer.groupBy({ by: ["isActive"], _count: true }),
    readRecentOrders(tx, {
      businessDate: dateRange(bounds),
      status: can(actor.roleCode, "orders.view") ? { not: "VOIDED" } : "POSTED",
    }),
    can(actor.roleCode, "account.view")
      ? readRecentTransactions(tx, bounds)
      : null,
    readDocumentDisplayPreferences(tx),
  ]);
  const byMonth = new Map(monthlySales.map((value) => [value.month, value]));
  return {
    scope: "financial" as const,
    today,
    period,
    bounds,
    totals,
    summary: { today: todayTotals, month, year, all },
    monthly: months.map(
      (month) => byMonth.get(month) ?? { ...emptySales, month },
    ),
    cash,
    companies: {
      active: companyCounts.find(({ isActive }) => isActive)?._count ?? 0,
      total: companyCounts.reduce((total, row) => total + row._count, 0),
    },
    balances: { receivable: customers.due, payable: suppliers.due },
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
