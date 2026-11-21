import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../src/domain/business-date";
import type { RoleCode } from "../../src/generated/prisma/client";
import { createPayment } from "../../src/server/account/payments";
import { getSession, issueSession } from "../../src/server/auth/session";
import { parseDashboardFilters } from "../../src/server/dashboard/period";
import {
  DashboardPeriodError,
  readDashboard,
} from "../../src/server/dashboard/workspace";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";
import {
  parsePartySummaryFilters,
  readPartySummaryReport,
} from "../../src/server/reporting/party-summary";
import { readSalesReportPage } from "../../src/server/reporting/sales-report";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const previous = new Date("2003-02-10T18:59:00Z");
const now = new Date("2003-02-10T19:01:00Z");
const today = "2003-02-11";

afterAll(() => database.$disconnect());

async function actor(roleCode: RoleCode, sessionTime = new Date()) {
  const key = `dashboard-${randomUUID()}`;
  const staff = await database.user.create({
    data: {
      username: key,
      email: `${key}@example.test`,
      displayName: "Dashboard test fixture",
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
    select: { id: true },
  });
  const token = await database.$transaction((tx) =>
    issueSession(tx, staff.id, sessionTime),
  );
  const principal = await getSession(token, database, sessionTime);
  if (!principal) throw new Error("Dashboard session fixture is missing.");
  return principal;
}

async function parties(userId: string) {
  const stamp = randomUUID().slice(0, 12);
  const change = { createdById: userId, updatedById: userId };
  const [customer, supplier] = await Promise.all([
    database.customer.create({
      data: {
        ...change,
        code: `DB-C-${stamp}`,
        name: `Customer ${stamp}`,
        nameKey: `customer ${stamp}`,
      },
      select: { id: true },
    }),
    database.supplier.create({
      data: {
        ...change,
        code: `DB-S-${stamp}`,
        name: `Supplier ${stamp}`,
        nameKey: `supplier ${stamp}`,
        mines: {
          create: {
            code: "Dashboard",
            codeKey: "dashboard",
            name: "Dashboard mine",
            isDefault: true,
          },
        },
      },
      select: { id: true, mines: { select: { id: true } } },
    }),
  ]);
  return {
    customerId: customer.id,
    supplierId: supplier.id,
    mineId: supplier.mines[0]!.id,
  };
}

const context = () => ({ requestId: randomUUID() });

describe("dashboard read model", () => {
  it("uses an inclusive Karachi business week and validates custom ranges", () => {
    expect(parseDashboardFilters({ period: "week" }, now)).toMatchObject({
      today,
      bounds: { from: "2003-02-10", to: today },
    });
    expect(parseDashboardFilters({ period: "today" }, previous)).toMatchObject({
      today: "2003-02-10",
      bounds: { from: "2003-02-10", to: "2003-02-10" },
    });
    expect(parseDashboardFilters({}, now)).toMatchObject({
      period: "month",
      bounds: { from: "2003-02-01", to: today },
    });
    expect(() => parseDashboardFilters({ period: "unsupported" }, now)).toThrow(
      DashboardPeriodError,
    );
    expect(() =>
      parseDashboardFilters(
        { period: "custom", from: today, to: "2003-02-10" },
        now,
      ),
    ).toThrow(expect.objectContaining({ field: "to" }));
  });

  it("reconciles exact selected totals with Sales and Party Reports and shows only permitted activity", async () => {
    const accountant = await actor("ACCOUNTANT");
    const viewer = await actor("VIEWER");
    const dispatchParty = await parties(accountant.userId);
    const { customerId, supplierId } = dispatchParty;
    const cashBank = await database.bank.findUniqueOrThrow({
      where: { nameKey: "cash" },
    });
    await database.ledgerEntry.create({
      data: {
        kind: "CUSTOMER_OPENING",
        customerId,
        amount: "100.25",
        businessDate: parseBusinessDate("2003-02-01"),
        actorId: accountant.userId,
      },
    });
    const { orderIds } = await createOrders(database, accountant, context(), {
      key: randomUUID(),
      businessDate: today,
      rows: [
        {
          ...dispatchParty,
          vehicleNo: "DASHBOARD",
          weight: "10.005",
          purchaseRate: "3.00",
          sellRate: "4.00",
        },
      ],
    });
    for (const payment of [
      { direction: "IN", partyId: customerId, amount: "5.00" },
      { direction: "OUT", partyId: supplierId, amount: "3.00" },
    ]) {
      await createPayment(database, accountant, context(), {
        key: randomUUID(),
        businessDate: today,
        method: "CASH",
        bankId: cashBank.id,
        ...payment,
      });
    }

    const dates = { from: today, to: today };
    const [dashboard, viewerDashboard, sales, balances] = await Promise.all([
      readDashboard(database, accountant, { period: "custom", ...dates }, now),
      readDashboard(database, viewer, { period: "custom", ...dates }, now),
      readSalesReportPage(database, accountant, { ...dates, groupBy: "date" }),
      database.$transaction(async (tx) => {
        const filters = parsePartySummaryFilters(dates, now);
        const customers = await readPartySummaryReport(tx, "customer", filters);
        const suppliers = await readPartySummaryReport(tx, "supplier", filters);
        return {
          receivable: customers.totals.pending,
          payable: suppliers.totals.pending,
        };
      }),
    ]);
    if (
      dashboard.scope !== "financial" ||
      viewerDashboard.scope !== "financial"
    )
      throw new Error("Financial dashboard data is missing.");
    expect(dashboard.totals).toEqual(sales.totals);
    expect(dashboard.totals).toEqual({
      trucks: 1,
      weight: "10.005",
      sales: "40.02",
      purchases: "30.02",
      profit: "10.00",
    });
    expect(viewerDashboard.totals).toEqual(dashboard.totals);
    expect(dashboard.balances).toEqual(balances);
    expect(dashboard.balances).toEqual({
      receivable: "135.27",
      payable: "27.02",
    });
    expect(dashboard.cash).toEqual({
      received: "5.00",
      paid: "3.00",
      balanceInHand: "2.00",
    });
    expect(dashboard.monthly).toHaveLength(12);
    expect(dashboard.monthly[0]).toMatchObject({ month: "2002-03", trucks: 0 });
    expect(dashboard.monthly.at(-1)).toEqual({
      month: "2003-02",
      ...sales.totals,
    });
    expect(dashboard.summary.today).toEqual(sales.totals);
    expect(dashboard.recentOrders).toMatchObject([
      { id: orderIds[0], date: today, weight: "10.005" },
    ]);
    expect(dashboard.transactions).toMatchObject([
      { direction: "OUT", amount: "3.00" },
      { direction: "IN", amount: "5.00" },
    ]);
    expect(viewerDashboard.transactions).toBeNull();
  });

  it("returns only the Operator's own Karachi-day dispatch fields despite a supplied custom period", async () => {
    const dispatchDay = todayBusinessDate();
    const midnight = Date.parse(`${dispatchDay}T00:00:00+05:00`);
    const beforeMidnight = new Date(midnight - 60_000);
    const afterMidnight = new Date(midnight + 60_000);
    const previousDay = todayBusinessDate(beforeMidnight);
    const dispatcher = await actor("OPERATOR", beforeMidnight);
    const other = await actor("OPERATOR", beforeMidnight);
    const party = await parties(dispatcher.userId);
    const row = { ...party, sellRate: "100.00", weight: "2.125" };
    async function dispatch(
      principal: typeof dispatcher,
      vehicleNo: string,
      businessDate: string,
      clock: Date,
    ) {
      return createOrders(
        database,
        principal,
        context(),
        { key: randomUUID(), businessDate, rows: [{ ...row, vehicleNo }] },
        clock,
      );
    }
    await dispatch(dispatcher, "PAST", previousDay, beforeMidnight);
    await dispatch(other, "OTHER", dispatchDay, afterMidnight);
    const { orderIds } = await dispatch(
      dispatcher,
      "MY-DISPATCH",
      dispatchDay,
      afterMidnight,
    );
    const result = await readDashboard(
      database,
      dispatcher,
      { period: "custom", from: previousDay, to: dispatchDay },
      afterMidnight,
    );
    expect(result).toEqual({
      scope: "dispatch",
      today: dispatchDay,
      period: "today",
      bounds: { from: dispatchDay, to: dispatchDay },
      totals: { trucks: 1, weight: "2.125" },
      preferences: expect.anything(),
      recentOrders: [
        {
          id: orderIds[0],
          orderNo: expect.any(String),
          status: "PENDING_PRICING",
          date: dispatchDay,
          vehicleNo: "MY-DISPATCH",
          customerName: expect.any(String),
          weight: "2.125",
        },
      ],
    });
  });
});
