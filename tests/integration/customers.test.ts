import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBusinessDate } from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import { Prisma, type RoleCode } from "../../src/generated/prisma/client";
import { hashPassword } from "../../src/server/auth/password";
import {
  createCustomer,
  listCustomers,
  readCustomer,
  updateCustomer,
} from "../../src/server/customers";
import { makePrisma } from "../../src/server/db/connect";
import {
  getPartyRollups,
  getPartyRollupTotals,
} from "../../src/server/repositories/party-ledger-rollups";
import { PeriodLockedError } from "../../src/server/repositories/periods";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const context = { requestId: randomUUID() };
const prefix = `Customer ${randomUUID()}`;
const asOf = "2006-07-02";
const defaultInput = (suffix: string) => ({
  name: `${prefix} ${suffix}`,
  requestKey: randomUUID(),
});
type Actor = { userId: string; sessionId: string; roleCode: RoleCode };
let owner: Actor;
let accountant: Actor;
let operator: Actor;

async function createActor(
  roleCode: RoleCode,
  passwordHash: string,
): Promise<Actor> {
  const username = `customer-${randomUUID()}`;
  const now = new Date();
  const user = await database.user.create({
    data: {
      username,
      displayName: username,
      email: `${username}@example.test`,
      roleCode,
      credential: { create: { passwordHash, mustChangePassword: false } },
      sessions: {
        create: {
          tokenDigest: randomBytes(32).toString("hex"),
          issuedAt: now,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
        },
      },
    },
    select: { id: true, sessions: { select: { id: true } } },
  });
  return { userId: user.id, sessionId: user.sessions[0].id, roleCode };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  owner = await createActor("OWNER", passwordHash);
  accountant = await createActor("ACCOUNTANT", passwordHash);
  operator = await createActor("OPERATOR", passwordHash);
});

afterAll(async () => {
  try {
    if (owner)
      await database.user.update({
        where: { id: owner.userId },
        data: { roleCode: "VIEWER" },
      });
  } finally {
    await database.$disconnect();
  }
});

describe("customer master data on PostgreSQL", () => {
  it("deduplicates customer creation and retains one exact, dated opening posting", async () => {
    const input = {
      ...defaultInput("Opening"),
      phone: "03001234567",
      creditLimit: "1000.00",
      openingAmount: "2000.25",
      openingDate: asOf,
    };
    const [customer, retry] = await Promise.all([
      createCustomer(database, owner, context, input),
      createCustomer(database, owner, context, input),
    ]);
    expect(customer).toEqual(retry);
    const record = await readCustomer(database, owner, customer.id);
    expect(record).toMatchObject({
      name: input.name,
      phone: "0300-1234567",
      creditLimit: "1000.00",
      opening: { amount: "2000.25", date: asOf },
    });
    expect(record?.code).toMatch(/^CUS-\d{3,}$/);
    expect(
      await database.ledgerEntry.count({ where: { customerId: customer.id } }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: { targetId: customer.id, action: "customer.create" },
      }),
    ).toBe(1);
    await expect(
      updateCustomer(database, owner, context, {
        ...input,
        requestKey: randomUUID(),
        id: customer.id,
        updatedAt: record?.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "openingExists" });
  });

  it("enforces opening role and period checks before creating any customer", async () => {
    const opening = { openingAmount: "12.04", openingDate: "2006-06-01" };
    await expect(
      createCustomer(database, accountant, context, {
        ...defaultInput("Denied opening"),
        ...opening,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      createCustomer(
        database,
        operator,
        context,
        defaultInput("Denied operator"),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const month = parseBusinessDate("2006-06-01");
    await database.periodLock.upsert({
      where: { month },
      create: { month, isMonthLocked: true, updatedById: owner.userId },
      update: { isMonthLocked: true, updatedById: owner.userId },
    });
    try {
      const input = { ...defaultInput("Locked opening"), ...opening };
      await expect(
        createCustomer(database, owner, context, input),
      ).rejects.toBeInstanceOf(PeriodLockedError);
      expect(
        await database.customer.count({ where: { name: input.name } }),
      ).toBe(0);
      expect(
        await database.idempotencyKey.count({
          where: { actorId: owner.userId, key: input.requestKey },
        }),
      ).toBe(0);
    } finally {
      await database.periodLock.update({
        where: { month },
        data: { isMonthLocked: false },
      });
    }
  });

  it("filters active status and retains old versions safely when two edits start from the same data", async () => {
    const input = { ...defaultInput("Deactivation"), phone: "0300-1234567" };
    const { id } = await createCustomer(database, accountant, context, input);
    const original = await readCustomer(database, accountant, id);
    await updateCustomer(database, accountant, context, {
      ...input,
      requestKey: randomUUID(),
      id,
      updatedAt: original?.updatedAt,
      isActive: false,
    });
    await expect(
      updateCustomer(database, accountant, context, {
        ...input,
        requestKey: randomUUID(),
        id,
        updatedAt: original?.updatedAt,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "stale" });
    const query = { q: input.name, status: "inactive", page: 999 } as const;
    const result = await listCustomers(database, accountant, query);
    expect(result).toMatchObject({
      mode: "financial",
      page: 1,
      lastPage: 1,
      matchedCount: 1,
      rows: [{ id, isActive: false }],
    });
    const directory = await listCustomers(database, operator, query);
    expect(directory).toMatchObject({
      mode: "directory",
      matchedCount: 0,
      rows: [],
    });
    const active = await createCustomer(database, accountant, context, {
      ...defaultInput("Active directory"),
      contactPerson: "Private Contact",
      creditLimit: "320.00",
    });
    const activeDirectory = await listCustomers(database, operator, {
      q: `${prefix} Active`,
      status: "all",
      page: 1,
    });
    expect(activeDirectory).toEqual({
      mode: "directory",
      matchedCount: 1,
      page: 1,
      lastPage: 1,
      status: "active",
      rows: [
        {
          id: active.id,
          code: expect.stringMatching(/^CUS-/),
          name: `${prefix} Active directory`,
        },
      ],
    });
    await expect(
      readCustomer(database, operator, active.id),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("sums signed opening and adjustment entries and keeps advances separate from other customers’ dues", async () => {
    const receivable = await createCustomer(database, owner, context, {
      ...defaultInput("Rollup plus"),
      openingAmount: "100.19",
      openingDate: asOf,
    });
    const advance = await createCustomer(
      database,
      owner,
      context,
      defaultInput("Rollup less"),
    );
    await database.ledgerEntry.createMany({
      data: [
        {
          kind: "CUSTOMER_ADJUSTMENT",
          businessDate: parseBusinessDate(asOf),
          customerId: advance.id,
          amount: "-25.50",
          actorId: owner.userId,
          reason: "Test credit",
        },
        {
          kind: "CUSTOMER_ADJUSTMENT",
          businessDate: parseBusinessDate("2006-07-03"),
          customerId: receivable.id,
          amount: "9.01",
          actorId: owner.userId,
          reason: "Test future posting",
        },
      ],
    });
    const [individual] = await getPartyRollups(
      database,
      "customer",
      [receivable.id],
      asOf,
    );
    expect(individual).toMatchObject({
      partyId: receivable.id,
      trucks: 0,
      balance: "100.19",
    });
    const totals = await getPartyRollupTotals(
      database,
      "customer",
      Prisma.sql`
      SELECT id FROM customers WHERE id IN (${receivable.id}::uuid, ${advance.id}::uuid)
    `,
      asOf,
    );
    expect(totals).toEqual({
      trucks: 0,
      weight: "0",
      billed: "0",
      settled: "0",
      balance: "74.69",
      due: "100.19",
      advance: "25.50",
    });
  });
});
