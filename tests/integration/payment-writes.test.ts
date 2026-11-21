import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { parseBusinessDate } from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import type { RoleCode } from "../../src/generated/prisma/client";
import {
  createPayment,
  transitionCheque,
  voidPayment,
} from "../../src/server/account/payments";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { getPartyRollups } from "../../src/server/repositories/party-ledger-rollups";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Use an isolated migrated PostgreSQL test database.");
const database = makePrisma(databaseUrl);
const clock = new Date();
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

function code() {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

async function actor(roleCode: RoleCode = "ACCOUNTANT") {
  const key = code();
  const staff = await database.user.create({
    data: {
      username: `payment_${key}`,
      email: `payment-${key}@example.test`,
      displayName: "Payment fixture",
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
    select: { id: true },
  });
  if (roleCode === "OWNER") ownerFixtures.push(staff.id);
  const token = await database.$transaction((tx) =>
    issueSession(tx, staff.id, clock),
  );
  const principal = await getSession(token, database, clock);
  if (!principal) throw new Error("Unable to start the fixture session.");
  return principal;
}

async function fixture(userId: string, opening = "100.00") {
  const key = code();
  const shared = {
    name: key,
    nameKey: key,
    createdById: userId,
    updatedById: userId,
  };
  const customer = await database.customer.create({
    data: { ...shared, code: `C-${key}` },
  });
  const supplier = await database.supplier.create({
    data: { ...shared, code: `S-${key}` },
  });
  const initial = {
    amount: opening,
    businessDate: parseBusinessDate("2020-01-01"),
    actorId: userId,
  };
  if (opening !== "0") {
    await database.ledgerEntry.createMany({
      data: [
        { ...initial, kind: "CUSTOMER_OPENING", customerId: customer.id },
        { ...initial, kind: "SUPPLIER_OPENING", supplierId: supplier.id },
      ],
    });
  }
  const cash = await database.bank.create({
    data: { name: `Cash ${key}`, nameKey: `cash ${key}`, category: "CASH" },
  });
  const bank = await database.bank.create({
    data: { name: `Bank ${key}`, nameKey: `bank ${key}`, category: "BANK" },
  });
  return { customer, supplier, cash, bank };
}

const context = () => ({ requestId: randomUUID() });

function cashReceipt(data: Awaited<ReturnType<typeof fixture>>) {
  return {
    key: randomUUID(),
    direction: "IN",
    partyId: data.customer.id,
    method: "CASH",
    bankId: data.cash.id,
    businessDate: "2024-01-15",
    amount: "25.45",
  };
}

describe("account voucher writes", () => {
  it("posts exact signed receipts and supplier payouts with stable sequential vouchers", async () => {
    const accountant = await actor();
    const data = await fixture(accountant.userId);
    const request = context();
    const input = cashReceipt(data);
    const first = await createPayment(
      database,
      accountant,
      request,
      input,
      clock,
    );
    await expect(
      createPayment(database, accountant, context(), input, clock),
    ).resolves.toEqual(first);
    const second = await createPayment(
      database,
      accountant,
      context(),
      {
        ...input,
        key: randomUUID(),
        direction: "OUT",
        partyId: data.supplier.id,
        amount: "9.10",
      },
      clock,
    );

    const receipt = await database.payment.findUniqueOrThrow({
      where: { id: first.paymentId },
      include: { ledgerEntries: true },
    });
    const payment = await database.payment.findUniqueOrThrow({
      where: { id: second.paymentId },
      include: { ledgerEntries: true },
    });
    expect(receipt).toMatchObject({
      direction: "IN",
      customerId: data.customer.id,
      supplierId: null,
      status: "POSTED",
      bankName: data.cash.name,
    });
    expect(receipt.amount.toFixed(2)).toBe("25.45");
    expect(
      receipt.ledgerEntries.map((entry) => [
        entry.kind,
        entry.amount.toFixed(2),
      ]),
    ).toEqual([["CUSTOMER_RECEIPT", "-25.45"]]);
    expect(payment).toMatchObject({
      direction: "OUT",
      supplierId: data.supplier.id,
      customerId: null,
      status: "POSTED",
    });
    expect(payment.amount.toFixed(2)).toBe("9.10");
    expect(
      payment.ledgerEntries.map((entry) => [
        entry.kind,
        entry.amount.toFixed(2),
      ]),
    ).toEqual([["SUPPLIER_PAYMENT", "-9.10"]]);
    expect(payment.ordinal).toBe(receipt.ordinal + 1n);
    expect(
      receipt.voucherNo.endsWith(String(receipt.ordinal).padStart(6, "0")),
    ).toBe(true);
    expect(
      await database.auditLog.count({
        where: { targetId: first.paymentId, action: "payment.create" },
      }),
    ).toBe(1);
  });

  it("validates bank category, reference, exact positive amount and explicit advance confirmation", async () => {
    const accountant = await actor();
    const data = await fixture(accountant.userId, "10.10");
    const input = cashReceipt(data);
    await expect(
      createPayment(
        database,
        accountant,
        context(),
        { ...input, amount: "0.00" },
        clock,
      ),
    ).rejects.toMatchObject({ code: "invalid", field: "amount" });
    await expect(
      createPayment(
        database,
        accountant,
        context(),
        { ...input, bankId: data.bank.id },
        clock,
      ),
    ).rejects.toMatchObject({ code: "wrongBankType", field: "bankId" });
    await expect(
      createPayment(
        database,
        accountant,
        context(),
        { ...input, method: "ONLINE_IBFT", bankId: data.bank.id },
        clock,
      ),
    ).rejects.toMatchObject({ code: "required", field: "referenceNo" });
    await expect(
      createPayment(database, accountant, context(), input, clock),
    ).rejects.toMatchObject({
      code: "advance",
      field: "amount",
      outstanding: "10.10",
      excess: "15.35",
    });
    expect(
      await database.payment.count({ where: { customerId: data.customer.id } }),
    ).toBe(0);
    await expect(
      createPayment(
        database,
        accountant,
        context(),
        { ...input, confirmAdvance: true },
        clock,
      ),
    ).resolves.toMatchObject({ paymentId: expect.any(String) });
    const [rollup] = await getPartyRollups(
      database,
      "customer",
      [data.customer.id],
      input.businessDate,
    );
    expect(rollup).toMatchObject({ balance: "-15.35", settled: "25.45" });
  });

  it("requires adjustment notes and posts non-cash settlement outside cash totals", async () => {
    const accountant = await actor();
    const data = await fixture(accountant.userId);
    const input = { ...cashReceipt(data), method: "ADJUSTMENT", bankId: null };
    await expect(
      createPayment(database, accountant, context(), input, clock),
    ).rejects.toMatchObject({ code: "required", field: "notes" });
    const result = await createPayment(
      database,
      accountant,
      context(),
      {
        ...input,
        notes: "Settlement applied against a documented credit.",
      },
      clock,
    );
    const posted = await database.payment.findUniqueOrThrow({
      where: { id: result.paymentId },
    });
    expect(posted).toMatchObject({ method: "ADJUSTMENT", bankId: null });
    const [rollup] = await getPartyRollups(
      database,
      "customer",
      [data.customer.id],
      input.businessDate,
    );
    expect(rollup?.balance).toBe("74.55");
    expect(Number(rollup?.settled)).toBe(0);
  });

  it("rejects wrong party state or closed period and keeps the counter on failed audit", async () => {
    const accountant = await actor();
    const data = await fixture(accountant.userId);
    const input = { ...cashReceipt(data), businessDate: "2024-08-15" };
    const initialCounter = await database.numberSequence.findUnique({
      where: { kind_scope: { kind: "VOUCHER", scope: 0 } },
    });
    await database.customer.update({
      where: { id: data.customer.id },
      data: { isActive: false },
    });
    await expect(
      createPayment(database, accountant, context(), input, clock),
    ).rejects.toMatchObject({ code: "missingOrInactive", field: "partyId" });
    await database.customer.update({
      where: { id: data.customer.id },
      data: { isActive: true },
    });
    await expect(
      createPayment(
        database,
        accountant,
        { ...context(), ipAddress: "unavailable" },
        input,
        clock,
      ),
    ).rejects.toThrow("valid source IP address");
    expect(
      await database.payment.count({ where: { customerId: data.customer.id } }),
    ).toBe(0);
    expect(
      await database.numberSequence.findUnique({
        where: { kind_scope: { kind: "VOUCHER", scope: 0 } },
      }),
    ).toEqual(initialCounter);
    await database.periodLock.create({
      data: {
        month: parseBusinessDate("2024-08-01"),
        isMonthLocked: true,
        updatedById: accountant.userId,
      },
    });
    await expect(
      createPayment(database, accountant, context(), input, clock),
    ).rejects.toMatchObject({ code: "closed", field: "businessDate" });
  });

  it("serializes simultaneous receipts before calculating the remaining amount owed", async () => {
    const [one, two] = await Promise.all([actor(), actor()]);
    const data = await fixture(one.userId, "30.00");
    const results = await Promise.allSettled(
      [one, two].map((person) =>
        createPayment(database, person, context(), cashReceipt(data), clock),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "advance", outstanding: "4.55", excess: "20.90" },
    });
    expect(
      await database.payment.count({ where: { customerId: data.customer.id } }),
    ).toBe(1);
  });
});

describe("cheques and voucher reversal", () => {
  it("writes one dated linked reversal when a deposited cheque bounces in a later open month", async () => {
    const accountant = await actor();
    const data = await fixture(accountant.userId);
    const payment = await createPayment(
      database,
      accountant,
      context(),
      {
        ...cashReceipt(data),
        method: "CHEQUE",
        bankId: data.bank.id,
        businessDate: "2024-05-10",
        referenceNo: "CHQ-1",
      },
      clock,
    );
    const voucherBefore = await database.payment.findUniqueOrThrow({
      where: { id: payment.paymentId },
    });
    expect(voucherBefore.status).toBe("RECEIVED");
    const target = {
      key: randomUUID(),
      paymentId: payment.paymentId,
      businessDate: "2024-05-12",
    };
    await expect(
      transitionCheque(
        database,
        accountant,
        context(),
        { ...target, targetStatus: "CLEARED" },
        clock,
      ),
    ).rejects.toMatchObject({ code: "transition", field: "targetStatus" });
    await transitionCheque(
      database,
      accountant,
      context(),
      { ...target, targetStatus: "DEPOSITED" },
      clock,
    );
    await database.periodLock.update({
      where: { month: parseBusinessDate("2024-05-01") },
      data: { isMonthLocked: true, updatedById: accountant.userId },
    });
    const bounce = {
      key: randomUUID(),
      paymentId: payment.paymentId,
      businessDate: "2024-06-01",
      targetStatus: "BOUNCED",
      reason: "Bank returned cheque.",
    };
    await expect(
      transitionCheque(
        database,
        accountant,
        context(),
        { ...bounce, reason: "" },
        clock,
      ),
    ).rejects.toMatchObject({ code: "required", field: "reason" });
    const repeated = await Promise.all(
      Array.from({ length: 2 }, () =>
        transitionCheque(database, accountant, context(), bounce, clock),
      ),
    );
    expect(repeated).toEqual([payment, payment]);
    await expect(
      transitionCheque(
        database,
        accountant,
        context(),
        { ...bounce, key: randomUUID() },
        clock,
      ),
    ).rejects.toMatchObject({ code: "reversed" });

    const voucher = await database.payment.findUniqueOrThrow({
      where: { id: payment.paymentId },
      include: {
        ledgerEntries: { orderBy: { id: "asc" } },
        chequeEvents: { orderBy: { id: "asc" } },
      },
    });
    expect(voucher).toMatchObject({
      status: "BOUNCED",
      voucherNo: voucherBefore.voucherNo,
    });
    expect(voucher.chequeEvents.map(({ resulting }) => resulting)).toEqual([
      "DEPOSITED",
      "BOUNCED",
    ]);
    const [original, reversal] = voucher.ledgerEntries;
    expect(reversal?.reversesId).toBe(original?.id);
    expect(reversal?.amount.toFixed(2)).toBe("25.45");
    expect(reversal?.businessDate).toEqual(parseBusinessDate("2024-06-01"));
    const [before] = await getPartyRollups(
      database,
      "customer",
      [data.customer.id],
      "2024-05-31",
    );
    const [after] = await getPartyRollups(
      database,
      "customer",
      [data.customer.id],
      "2024-06-01",
    );
    expect(before?.balance).toBe("74.55");
    expect(after?.balance).toBe("100.00");
  });

  it("clears a cheque without changing postings and restricts later void to Owner", async () => {
    const accountant = await actor();
    const owner = await actor("OWNER");
    const data = await fixture(accountant.userId);
    const payment = await createPayment(
      database,
      accountant,
      context(),
      {
        ...cashReceipt(data),
        direction: "OUT",
        partyId: data.supplier.id,
        method: "CHEQUE",
        bankId: data.bank.id,
        businessDate: "2024-10-01",
        referenceNo: "CHQ-2",
      },
      clock,
    );
    await transitionCheque(
      database,
      accountant,
      context(),
      {
        key: randomUUID(),
        ...payment,
        businessDate: "2024-10-11",
        targetStatus: "DEPOSITED",
      },
      clock,
    );
    await expect(
      transitionCheque(
        database,
        accountant,
        context(),
        {
          key: randomUUID(),
          ...payment,
          businessDate: "2024-10-06",
          targetStatus: "CLEARED",
        },
        clock,
      ),
    ).rejects.toMatchObject({ code: "invalid", field: "businessDate" });
    await transitionCheque(
      database,
      accountant,
      context(),
      {
        key: randomUUID(),
        ...payment,
        businessDate: "2024-10-13",
        targetStatus: "CLEARED",
      },
      clock,
    );
    expect(
      await database.ledgerEntry.count({
        where: { paymentId: payment.paymentId },
      }),
    ).toBe(1);
    const voidCommand = {
      key: randomUUID(),
      ...payment,
      businessDate: "2024-10-15",
      reason: "Duplicate supplier document.",
    };
    await expect(
      voidPayment(database, accountant, context(), voidCommand, clock),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await voidPayment(database, owner, context(), voidCommand, clock);
    await expect(
      voidPayment(database, owner, context(), voidCommand, clock),
    ).resolves.toEqual(payment);
    const final = await database.payment.findUniqueOrThrow({
      where: { id: payment.paymentId },
      include: { ledgerEntries: { orderBy: { id: "asc" } } },
    });
    expect(final).toMatchObject({
      status: "VOIDED",
      voidedById: owner.userId,
      voidReason: voidCommand.reason,
    });
    expect(final.ledgerEntries.map((entry) => entry.amount.toFixed(2))).toEqual(
      ["-25.45", "25.45"],
    );
    expect(final.ledgerEntries[1]?.reversesId).toBe(final.ledgerEntries[0]?.id);
  });
});
