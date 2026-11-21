import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../src/domain/business-date";
import type { RoleCode } from "../../src/generated/prisma/client";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Use an isolated migrated PostgreSQL test database.");
const database = makePrisma(databaseUrl);
const clock = new Date();

afterAll(() => database.$disconnect());

async function actor(roleCode: RoleCode = "ACCOUNTANT") {
  const key = randomUUID().replaceAll("-", "").slice(0, 16);
  const staff = await database.user.create({
    data: {
      username: `order_${key}`,
      email: `order-${key}@example.test`,
      displayName: "Order fixture",
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
    select: { id: true },
  });
  const token = await database.$transaction((tx) =>
    issueSession(tx, staff.id, clock),
  );
  const principal = await getSession(token, database, clock);
  if (!principal) throw new Error("Unable to start the fixture session.");
  return principal;
}

async function parties(
  userId: string,
  input: { creditLimit?: string; active?: boolean } = {},
) {
  const key = randomUUID().slice(0, 12);
  const nameFields = {
    name: key,
    nameKey: key,
    createdById: userId,
    updatedById: userId,
  };
  const customer = await database.customer.create({
    data: {
      ...nameFields,
      code: `C-${key}`,
      creditLimit: input.creditLimit,
      isActive: input.active ?? true,
    },
    select: { id: true },
  });
  const supplier = await database.supplier.create({
    data: {
      ...nameFields,
      code: `S-${key}`,
      mines: {
        create: {
          code: "Mine-01",
          codeKey: "mine-01",
          name: "Default mine",
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

function row(
  party: { customerId: string; supplierId: string; mineId?: string },
  vehicleNo = "TX-100",
) {
  return {
    ...party,
    vehicleNo,
    weight: "10.005",
    sellRate: "4.00",
    purchaseRate: "3.00",
  };
}

const request = () => ({ requestId: randomUUID() });

describe("bulk order entry", () => {
  it("posts exact snapshots, immutable ledger pairs and audit activity once", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId);
    const context = request();
    const payload = {
      key: randomUUID(),
      businessDate: "2023-06-15",
      rows: [
        {
          ...row(references, "tx 100"),
          mineId: undefined,
          biltyNo: "  load-12  ",
        },
        row(references, "TX-200"),
      ],
    };
    const result = await createOrders(
      database,
      accountant,
      context,
      payload,
      clock,
    );
    await expect(
      createOrders(database, accountant, request(), payload, clock),
    ).resolves.toEqual(result);
    const created = await database.order.findMany({
      where: { id: { in: result.orderIds } },
      orderBy: { ordinal: "asc" },
      include: { currentRevision: { include: { ledgerEntries: true } } },
    });
    expect(created.map(({ ordinal }) => ordinal)).toEqual([1n, 2n]);
    expect(created.map(({ orderNo }) => orderNo.slice(-9))).toEqual([
      "2023-0001",
      "2023-0002",
    ]);
    expect(created[0]).toMatchObject({
      status: "POSTED",
      vehicleNo: "TX-100",
      biltyNo: "LOAD-12",
      mineId: references.mineId,
    });
    expect(created[0]?.currentRevision?.buyAmount?.toFixed(2)).toBe("30.02");
    expect(created[0]?.currentRevision?.sellAmount?.toFixed(2)).toBe("40.02");
    expect(created[0]?.currentRevision?.profit?.toFixed(2)).toBe("10.00");
    expect(
      created[0]?.currentRevision?.ledgerEntries.map(({ kind, amount }) => ({
        kind,
        amount: amount.toFixed(2),
      })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "ORDER_SALE", amount: "40.02" },
        { kind: "ORDER_PURCHASE", amount: "30.02" },
      ]),
    );
    expect(
      await database.auditLog.count({
        where: { requestId: context.requestId, action: "order.create" },
      }),
    ).toBe(2);
    expect(
      await database.auditLog.count({
        where: { targetId: { in: result.orderIds }, action: "order.create" },
      }),
    ).toBe(2);
  });

  it("reports row errors and preserves the counter and transaction on failure", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId);
    const inactive = await parties(accountant.userId, { active: false });
    const key = randomUUID();
    const payload = {
      key,
      businessDate: "2022-07-19",
      rows: [row(references), row(inactive, "TX-200")],
    };
    await expect(
      createOrders(database, accountant, request(), payload, clock),
    ).rejects.toMatchObject({
      issues: [{ row: 1, field: "customerId", code: "missingOrInactive" }],
    });
    expect(
      await database.order.count({
        where: { businessDate: parseBusinessDate(payload.businessDate) },
      }),
    ).toBe(0);
    expect(
      await database.numberSequence.count({
        where: { kind: "ORDER", scope: 2022 },
      }),
    ).toBe(0);
    expect(
      await database.idempotencyKey.count({
        where: { key, actorId: accountant.userId },
      }),
    ).toBe(0);
    const retry = await createOrders(
      database,
      accountant,
      request(),
      { ...payload, rows: [row(references)] },
      clock,
    );
    expect(
      await database.order.findUnique({ where: { id: retry.orderIds[0] } }),
    ).toMatchObject({ ordinal: 1n });
  });

  it("rolls back the order, revision, ledger and counter if auditing fails", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId);
    const payload = {
      key: randomUUID(),
      businessDate: "2017-02-08",
      rows: [row(references)],
    };
    await expect(
      createOrders(
        database,
        accountant,
        { ...request(), ipAddress: "unavailable" },
        payload,
        clock,
      ),
    ).rejects.toThrow("valid source IP address");
    expect(
      await database.order.count({
        where: { customerId: references.customerId },
      }),
    ).toBe(0);
    expect(
      await database.orderRevision.count({
        where: { customerId: references.customerId },
      }),
    ).toBe(0);
    expect(
      await database.ledgerEntry.count({
        where: { customerId: references.customerId },
      }),
    ).toBe(0);
    expect(
      await database.numberSequence.count({
        where: { kind: "ORDER", scope: 2017 },
      }),
    ).toBe(0);
    await expect(
      createOrders(database, accountant, request(), payload, clock),
    ).resolves.toMatchObject({
      orderIds: [expect.any(String)],
    });
  });

  it("accepts today's Operator dispatch as pending pricing with no ledger entries", async () => {
    const dispatcher = await actor("OPERATOR");
    const references = await parties(dispatcher.userId);
    const input = row(references, "PEND-100");
    const businessDate = todayBusinessDate(clock);
    const key = randomUUID();
    await expect(
      createOrders(
        database,
        dispatcher,
        request(),
        { key, businessDate, rows: [input] },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ row: 0, field: "purchaseRate", code: "pricingForbidden" }],
    });
    const { purchaseRate, ...dispatch } = input;
    expect(purchaseRate).toBe("3.00");
    await expect(
      createOrders(
        database,
        dispatcher,
        request(),
        { key, businessDate: "2021-02-04", rows: [dispatch] },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: "businessDate", code: "dateScope" }],
    });
    const result = await createOrders(
      database,
      dispatcher,
      request(),
      { key, businessDate, rows: [dispatch] },
      clock,
    );
    const pending = await database.order.findUniqueOrThrow({
      where: { id: result.orderIds[0] },
      include: { currentRevision: { include: { ledgerEntries: true } } },
    });
    expect(pending).toMatchObject({
      status: "PENDING_PRICING",
      currentRevision: {
        purchaseRate: null,
        sellAmount: null,
        buyAmount: null,
        profit: null,
        ledgerEntries: [],
      },
    });
  });

  it("requires confirmation for repeat vehicles and always rejects a duplicate bilty", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId);
    const date = "2021-03-02";
    const key = randomUUID();
    await createOrders(
      database,
      accountant,
      request(),
      {
        key: randomUUID(),
        businessDate: date,
        rows: [{ ...row(references, "R-222"), biltyNo: "slip 01" }],
      },
      clock,
    );
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          key,
          businessDate: date,
          rows: [row(references, "r222")],
        },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ row: 0, field: "vehicleNo", code: "duplicateVehicle" }],
    });
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          key,
          businessDate: date,
          rows: [
            {
              ...row(references, "R222"),
              confirmDuplicateVehicle: true,
              biltyNo: "  SLIP 01  ",
            },
          ],
        },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ row: 0, field: "biltyNo", code: "duplicateBilty" }],
    });
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          key,
          businessDate: date,
          rows: [
            {
              ...row(references, "R 222"),
              confirmDuplicateVehicle: true,
              biltyNo: "SLIP 02",
            },
          ],
        },
        clock,
      ),
    ).resolves.toMatchObject({ orderIds: [expect.any(String)] });
  });

  it("checks combined credit exposure against the customer limit", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId, {
      creditLimit: "60.00",
    });
    const payload = {
      key: randomUUID(),
      businessDate: "2020-09-01",
      rows: [row(references, "LIMIT-10"), row(references, "LIMIT-11")],
    };
    await expect(
      createOrders(database, accountant, request(), payload, clock),
    ).rejects.toMatchObject({
      issues: [{ row: 1, field: "customerId", code: "creditLimit" }],
    });
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          ...payload,
          rows: [
            row(references, "LIMIT-10"),
            { ...row(references, "LIMIT-11"), confirmCreditLimit: true },
          ],
        },
        clock,
      ),
    ).resolves.toMatchObject({
      orderIds: [expect.any(String), expect.any(String)],
    });
  });

  it("checks the mine's supplier association and accounting-month lock", async () => {
    const accountant = await actor();
    const references = await parties(accountant.userId);
    const other = await parties(accountant.userId);
    const key = randomUUID();
    const date = "2019-04-02";
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          key,
          businessDate: date,
          rows: [{ ...row(references), mineId: other.mineId }],
        },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ row: 0, field: "mineId", code: "missingOrInactive" }],
    });

    await database.periodLock.upsert({
      where: { month: parseBusinessDate("2019-04-01") },
      create: {
        month: parseBusinessDate("2019-04-01"),
        isMonthLocked: true,
        updatedById: accountant.userId,
      },
      update: { isMonthLocked: true, updatedById: accountant.userId },
    });
    await expect(
      createOrders(
        database,
        accountant,
        request(),
        {
          key,
          businessDate: date,
          rows: [row(references)],
        },
        clock,
      ),
    ).rejects.toMatchObject({
      issues: [{ field: "businessDate", code: "closed" }],
    });
    expect(
      await database.order.count({
        where: { businessDate: parseBusinessDate(date) },
      }),
    ).toBe(0);
  });

  it("allocates disjoint consecutive order numbers when independent staff write together", async () => {
    const one = await actor();
    const two = await actor();
    const references = await parties(one.userId);
    const businessDate = "2018-05-08";
    const results = await Promise.all(
      [one, two].map((accountant, index) =>
        createOrders(
          database,
          accountant,
          request(),
          {
            key: randomUUID(),
            businessDate,
            rows: [
              row(references, `RACE-${index}-1`),
              row(references, `RACE-${index}-2`),
            ],
          },
          clock,
        ),
      ),
    );
    const orders = await database.order.findMany({
      where: { id: { in: results.flatMap(({ orderIds }) => orderIds) } },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true },
    });
    expect(orders.map(({ ordinal }) => ordinal)).toEqual([1n, 2n, 3n, 4n]);
  });
});
