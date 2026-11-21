import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { PermissionDenied } from "../../src/domain/permissions";
import type { RoleCode } from "../../src/generated/prisma/client";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";
import {
  correctOrder,
  editOrderMetadata,
  voidOrders,
} from "../../src/server/orders/mutations";
import {
  ReportPeriodError,
  resolveReportPeriod,
} from "../../src/server/reporting/period";
import {
  readSalesDetailsExport,
  readSalesDetailsPage,
  SalesFiltersError,
} from "../../src/server/reporting/sales-details";
import { readSalesSummary } from "../../src/server/reporting/sales-facts";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Use an isolated migrated PostgreSQL test database.");
const database = makePrisma(databaseUrl);
const ownerFixtures: string[] = [];

afterAll(async () => {
  try {
    await database.user.updateMany({
      where: { id: { in: ownerFixtures } },
      data: { roleCode: "VIEWER" },
    });
  } finally {
    await database.$disconnect();
  }
});

async function actor(roleCode: RoleCode = "ACCOUNTANT") {
  const key = randomUUID().replaceAll("-", "").slice(0, 16);
  const staff = await database.user.create({
    data: {
      username: `sales_${key}`,
      email: `sales-${key}@example.test`,
      displayName: "Sales details fixture",
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
    select: { id: true },
  });
  if (roleCode === "OWNER") ownerFixtures.push(staff.id);
  const token = await database.$transaction((tx) => issueSession(tx, staff.id));
  const principal = await getSession(token, database);
  if (!principal) throw new Error("Unable to start the fixture session.");
  return principal;
}

async function parties(userId: string) {
  const key = randomUUID().slice(0, 13);
  const maker = { createdById: userId, updatedById: userId };
  const customer = await database.customer.create({
    data: {
      ...maker,
      code: `C-${key}`,
      name: `Receiver ${key}`,
      nameKey: `receiver ${key}`,
    },
    select: { id: true },
  });
  const supplier = await database.supplier.create({
    data: {
      ...maker,
      code: `S-${key}`,
      name: `Origin ${key}`,
      nameKey: `origin ${key}`,
      mines: {
        create: {
          code: "Sales-001",
          codeKey: "sales-001",
          name: "Sales fixture mine",
          isDefault: true,
        },
      },
    },
    select: { id: true, mines: { select: { id: true } } },
  });
  return {
    customerId: customer.id,
    supplierId: supplier.id,
    mineId: supplier.mines[0]!.id,
  };
}

const context = () => ({ requestId: randomUUID() });

function dispatch(
  party: Awaited<ReturnType<typeof parties>>,
  vehicleNo: string,
  weight = "10.005",
) {
  return {
    ...party,
    vehicleNo,
    weight,
    purchaseRate: "3.00",
    sellRate: "4.00",
  };
}

describe("sales period and signed facts", () => {
  it("uses Karachi month defaults, honors leap dates, and validates disjoint windows", () => {
    expect(
      resolveReportPeriod({ month: "2" }, new Date("2024-01-01T12:00:00Z")),
    ).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(
      resolveReportPeriod({
        year: "2025",
        month: "11",
        from: "2025-11-10",
        to: "2026-01-01",
      }),
    ).toEqual({
      from: "2025-11-10",
      to: "2025-11-30",
    });
    expect(() =>
      resolveReportPeriod({ year: "2025", from: "2026-01-01" }),
    ).toThrow(ReportPeriodError);
    expect(() => resolveReportPeriod({ from: "2025-02-29" })).toThrow(
      ReportPeriodError,
    );
  });

  it("returns stable sort and pagination with exact full-filter totals and export parity", async () => {
    const accountant = await actor();
    const party = await parties(accountant.userId);
    await createOrders(database, accountant, context(), {
      key: randomUUID(),
      businessDate: "2014-08-05",
      rows: Array.from({ length: 12 }, (_, index) =>
        dispatch(party, `EXPORT-${index + 1}`, String(index + 1)),
      ),
    });
    // This order must not match the supplier/date filter.
    await createOrders(database, accountant, context(), {
      key: randomUUID(),
      businessDate: "2014-08-06",
      rows: [dispatch(party, "NEXT-DAY")],
    });
    const filters = {
      year: "2014",
      month: "8",
      from: "2014-08-05",
      to: "2014-08-05",
      customerId: party.customerId,
      supplierId: party.supplierId,
      q: "export-",
      sort: "weight",
      direction: "asc",
      pageSize: "10",
    };
    const first = await readSalesDetailsPage(database, accountant, filters);
    const second = await readSalesDetailsPage(database, accountant, {
      ...filters,
      page: "2",
    });
    expect(first.page).toBe(1);
    expect(first.pages).toBe(2);
    expect(second.rows.map((row) => row.weight)).toEqual(["11.000", "12.000"]);
    expect(first.total).toBe(12);
    expect(first.totals).toEqual({
      trucks: 12,
      weight: "78.000",
      purchases: "234.00",
      sales: "312.00",
      profit: "78.00",
    });
    expect(second.totals).toEqual(first.totals);
    const exported = await database.$transaction((tx) =>
      readSalesDetailsExport(tx, accountant, filters, 25),
    );
    expect(exported.rows).toEqual([...first.rows, ...second.rows]);
    expect(exported.totals).toEqual(first.totals);
    expect(exported.total).toBe(12);
    await expect(
      readSalesDetailsPage(database, accountant, { sort: "unsupported" }),
    ).rejects.toBeInstanceOf(SalesFiltersError);
  });

  it("reconciles current metadata, dated posting corrections and bulk void with shared totals", async () => {
    const owner = await actor("OWNER");
    const party = await parties(owner.userId);
    const candidate = dispatch(party, "BEFORE-META");
    const { orderIds } = await createOrders(database, owner, context(), {
      key: randomUUID(),
      businessDate: "2013-07-19",
      rows: [candidate],
    });
    const [orderId] = orderIds;
    await editOrderMetadata(database, owner, context(), {
      key: randomUUID(),
      orderId,
      revisionNo: 1,
      vehicleNo: "AFTER-META",
    });
    const search = await readSalesDetailsPage(database, owner, {
      from: "2013-07-19",
      to: "2013-07-19",
      q: "after-meta",
    });
    expect(search.rows).toMatchObject([
      { id: orderId, vehicleNo: "AFTER-META", profit: "10.00" },
    ]);
    expect(search.totals).toMatchObject({
      trucks: 1,
      sales: "40.02",
      purchases: "30.02",
    });

    await correctOrder(database, owner, context(), {
      ...candidate,
      businessDate: "2013-08-01",
      key: randomUUID(),
      orderId,
      revisionNo: 2,
      vehicleNo: "AFTER-META",
      weight: "15.500",
      reason: "Entered dispatch on the incorrect date.",
    });
    const before = await readSalesSummary(database, {
      from: "2013-07-19",
      to: "2013-07-19",
      ...party,
    });
    expect(before).toMatchObject({
      trucks: 0,
      weight: "0.000",
      sales: "0.00",
      purchases: "0.00",
    });
    const after = await readSalesDetailsPage(database, owner, {
      year: "2013",
      month: "8",
      customerId: party.customerId,
    });
    expect(after.totals).toMatchObject({
      trucks: 1,
      weight: "15.500",
      sales: "62.00",
      purchases: "46.50",
      profit: "15.50",
    });
    expect(after.rows).toMatchObject([{ id: orderId, revisionNo: 3 }]);
    await voidOrders(database, owner, context(), {
      key: randomUUID(),
      reason: "Dispatch cancelled.",
      orders: [{ orderId, revisionNo: 3 }],
    });
    const voided = await readSalesDetailsPage(database, owner, {
      year: "2013",
      month: "8",
      customerId: party.customerId,
    });
    expect(voided.rows).toHaveLength(0);
    expect(voided.totals).toMatchObject({
      trucks: 0,
      weight: "0.000",
      sales: "0.00",
      purchases: "0.00",
    });
  });

  it("restricts table and export to authorized roles", async () => {
    const operator = await actor("OPERATOR");
    const viewer = await actor("VIEWER");
    await expect(
      readSalesDetailsPage(database, operator),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      database.$transaction((tx) => readSalesDetailsExport(tx, viewer, {}, 25)),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
