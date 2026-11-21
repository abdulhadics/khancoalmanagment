import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import type { RoleCode } from "../../src/generated/prisma/client";
import type { LivePrincipal } from "../../src/server/auth/live-principal";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";
import {
  correctOrder,
  editOrderMetadata,
  editPendingOrder,
  priceOrder,
  voidOrder,
  voidOrders,
} from "../../src/server/orders/mutations";
import { getPartyRollups } from "../../src/server/repositories/party-ledger-rollups";
import { PeriodLockedError } from "../../src/server/repositories/periods";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const context = { requestId: randomUUID() };
const today = todayBusinessDate();
let owner: LivePrincipal;
let accountant: LivePrincipal;
let operator: LivePrincipal;
let otherOperator: LivePrincipal;

async function createActor(
  roleCode: RoleCode,
  passwordHash: string,
): Promise<LivePrincipal> {
  const username = `order-mutation-${randomUUID()}`;
  const now = new Date();
  const record = await database.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: username,
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
  return { userId: record.id, sessionId: record.sessions[0].id, roleCode };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  owner = await createActor("OWNER", passwordHash);
  accountant = await createActor("ACCOUNTANT", passwordHash);
  operator = await createActor("OPERATOR", passwordHash);
  otherOperator = await createActor("OPERATOR", passwordHash);
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

async function dispatchRow() {
  const suffix = randomBytes(6).toString("hex");
  const audit = { createdById: owner.userId, updatedById: owner.userId };
  const customer = await database.customer.create({
    data: {
      ...audit,
      code: `KCT-C-${suffix}`,
      name: `Buyer ${suffix}`,
      nameKey: `buyer ${suffix}`,
    },
  });
  const supplier = await database.supplier.create({
    data: {
      ...audit,
      code: `KCT-S-${suffix}`,
      name: `Supplier ${suffix}`,
      nameKey: `supplier ${suffix}`,
    },
  });
  const mine = await database.mine.create({
    data: {
      supplierId: supplier.id,
      name: "North Mine",
      code: "North",
      codeKey: "north",
      isDefault: true,
    },
  });
  return {
    customerId: customer.id,
    supplierId: supplier.id,
    mineId: mine.id,
    vehicleNo: `TV-${suffix}`,
    biltyNo: `BL-${suffix}`,
    weight: "10.005",
    sellRate: "4.00",
  };
}

type DispatchRow = Awaited<ReturnType<typeof dispatchRow>> & {
  purchaseRate?: string;
};

async function createOne(
  actor: LivePrincipal,
  row: DispatchRow,
  businessDate = today,
) {
  const { orderIds } = await createOrders(database, actor, context, {
    key: randomUUID(),
    businessDate,
    rows: [row],
  });
  return orderIds[0];
}

function readOrder(id: string) {
  return database.order.findUniqueOrThrow({
    where: { id },
    include: { currentRevision: true },
  });
}

function readPostings(orderId: string) {
  return database.ledgerEntry.findMany({
    where: { orderRevision: { is: { orderId } } },
    orderBy: { id: "asc" },
  });
}

describe("order correction workflows on PostgreSQL", () => {
  it("restricts pending edits to the Operator’s own current date and posts amounts only after pricing", async () => {
    const row = await dispatchRow();
    const orderId = await createOne(operator, row);
    const pending = {
      ...row,
      businessDate: today,
      orderId,
      revisionNo: 1,
      key: randomUUID(),
      weight: "11.005",
    };
    await expect(
      editPendingOrder(database, otherOperator, context, pending),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      editPendingOrder(database, operator, context, {
        ...pending,
        purchaseRate: "3.00",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      editPendingOrder(database, operator, context, {
        ...pending,
        businessDate: "2007-04-20",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await editPendingOrder(database, operator, context, pending);
    expect(await readPostings(orderId)).toEqual([]);
    const priced = {
      ...pending,
      revisionNo: 2,
      key: randomUUID(),
      purchaseRate: "3.00",
    };
    await expect(
      priceOrder(database, operator, context, priced),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      priceOrder(database, accountant, context, {
        ...priced,
        purchaseRate: null,
      }),
    ).rejects.toMatchObject({ code: "invalid", field: "purchaseRate" });
    await priceOrder(database, accountant, context, priced);
    await expect(
      priceOrder(database, accountant, context, priced),
    ).resolves.toEqual({ id: orderId });
    const posted = await readOrder(orderId);
    expect(posted).toMatchObject({ status: "POSTED", currentRevisionNo: 3 });
    expect(posted.currentRevision?.buyAmount?.toFixed(2)).toBe("33.02");
    expect(posted.currentRevision?.profit?.toFixed(2)).toBe("11.00");
    const ledger = await readPostings(orderId);
    expect(ledger.map(({ amount }) => amount.toFixed(2))).toEqual([
      "44.02",
      "33.02",
    ]);

    const initialProfile = await database.companySettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const freshProfile = await database.documentProfile.create({
      data: { name: "New test letterhead" },
    });
    await database.companySettings.update({
      where: { id: 1 },
      data: { documentProfileId: freshProfile.id },
    });
    try {
      const metadata = {
        orderId,
        revisionNo: 3,
        key: randomUUID(),
        vehicleNo: row.vehicleNo,
        biltyNo: "updated bilty",
        notes: "Edited dispatch metadata",
      };
      await expect(
        editOrderMetadata(database, operator, context, {
          ...metadata,
          weight: "25",
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      await editOrderMetadata(database, operator, context, metadata);
      const revised = await readOrder(orderId);
      expect(revised).toMatchObject({
        status: "POSTED",
        currentRevisionNo: 4,
        biltyNo: "UPDATED BILTY",
      });
      expect(revised.currentRevision?.documentProfileId).toBe(
        posted.currentRevision?.documentProfileId,
      );
      expect(await readPostings(orderId)).toEqual(ledger);
    } finally {
      await database.companySettings.update({
        where: { id: 1 },
        data: { documentProfileId: initialProfile.documentProfileId },
      });
    }
  });

  it("uses paired reversals for financial corrections and keeps the numbered order after voiding", async () => {
    const row = { ...(await dispatchRow()), purchaseRate: "3.00" };
    const originalDate = "2007-04-20";
    const correctedDate = "2007-05-05";
    const orderId = await createOne(accountant, row, originalDate);
    const original = await readOrder(orderId);
    const originalEntries = await readPostings(orderId);
    const correction = {
      ...row,
      orderId,
      revisionNo: 1,
      key: randomUUID(),
      businessDate: correctedDate,
      weight: "20.005",
      reason: "Corrected scale ticket",
    };
    await correctOrder(database, accountant, context, correction);
    const corrected = await readOrder(orderId);
    expect(corrected).toMatchObject({
      orderNo: original.orderNo,
      currentRevisionNo: 2,
    });
    const entries = await readPostings(orderId);
    expect(entries.map(({ amount }) => amount.toFixed(2))).toEqual([
      "40.02",
      "30.02",
      "-40.02",
      "-30.02",
      "80.02",
      "60.02",
    ]);
    expect(
      entries
        .slice(2, 4)
        .map(({ reversesId, businessDate }) => [reversesId, businessDate]),
    ).toEqual(
      originalEntries.map(({ id, businessDate }) => [id, businessDate]),
    );
    const [originalMonth] = await getPartyRollups(
      database,
      "customer",
      [row.customerId],
      originalDate,
    );
    expect(originalMonth).toMatchObject({
      trucks: 0,
      weight: "0.000",
      billed: "0.00",
    });
    const [newMonth] = await getPartyRollups(
      database,
      "customer",
      [row.customerId],
      correctedDate,
    );
    expect(newMonth).toMatchObject({
      trucks: 1,
      weight: "20.005",
      billed: "80.02",
    });
    await expect(
      correctOrder(database, accountant, context, {
        ...correction,
        key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "stale" });

    const close = {
      orderId,
      revisionNo: 2,
      key: randomUUID(),
      reason: "Dispatch withdrawn",
    };
    await expect(
      voidOrder(database, accountant, context, close),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await voidOrder(database, owner, context, close);
    await voidOrder(database, owner, context, close);
    const retained = await readOrder(orderId);
    expect(retained).toMatchObject({
      orderNo: original.orderNo,
      status: "VOIDED",
      deletedById: owner.userId,
      deleteReason: close.reason,
    });
    expect(await readPostings(orderId)).toHaveLength(8);
    const [voidedBalance] = await getPartyRollups(database, "customer", [
      row.customerId,
    ]);
    expect(voidedBalance).toMatchObject({
      trucks: 0,
      weight: "0.000",
      balance: "0.00",
    });
  });

  it("voids a batch atomically and permits a stored retry independent of selection order", async () => {
    const first = await createOne(
      accountant,
      { ...(await dispatchRow()), purchaseRate: "1.00" },
      "2007-08-19",
    );
    const second = await createOne(
      accountant,
      { ...(await dispatchRow()), purchaseRate: "1.00" },
      "2007-09-19",
    );
    const month = parseBusinessDate("2007-09-01");
    await database.periodLock.update({
      where: { month },
      data: { isMonthLocked: true, updatedById: owner.userId },
    });
    const request = {
      key: randomUUID(),
      reason: "Withdraw both dispatches",
      orders: [
        { orderId: first, revisionNo: 1 },
        { orderId: second, revisionNo: 1 },
      ],
    };
    try {
      await expect(
        voidOrders(database, owner, context, request),
      ).rejects.toBeInstanceOf(PeriodLockedError);
      expect((await readOrder(first)).status).toBe("POSTED");
      expect(await readPostings(first)).toHaveLength(2);
    } finally {
      await database.periodLock.update({
        where: { month },
        data: { isMonthLocked: false },
      });
    }
    const result = await voidOrders(database, owner, context, request);
    await expect(
      voidOrders(database, owner, context, {
        ...request,
        orders: request.orders.slice().reverse(),
      }),
    ).resolves.toEqual(result);
    expect((await readOrder(first)).status).toBe("VOIDED");
    expect((await readOrder(second)).status).toBe("VOIDED");
    expect(await readPostings(first)).toHaveLength(4);
    expect(await readPostings(second)).toHaveLength(4);
  });
});
