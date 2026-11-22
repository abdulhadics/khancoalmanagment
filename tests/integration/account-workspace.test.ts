import { randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBusinessDate } from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import {
  createPayment,
  transitionCheque,
} from "../../src/server/account/payments";
import {
  readAccountFormCatalog,
  readAccountFormOptions,
  readAccountWorkspace,
  readPaymentPartyBalance,
} from "../../src/server/account/workspace";
import type { LivePrincipal } from "../../src/server/auth/live-principal";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";
import { getCashMovementTotals } from "../../src/server/repositories/cash-movement";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const context = { requestId: randomUUID() };
const label = randomBytes(6).toString("hex");
const issuedDate = "2008-02-12";
const depositDate = "2008-02-13";
const bounceDate = "2008-02-14";
let accountant: LivePrincipal;

beforeAll(async () => {
  const now = new Date();
  const username = `account-read-${randomUUID()}`;
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  const actor = await database.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Account read fixture",
      roleCode: "ACCOUNTANT",
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
  accountant = {
    userId: actor.id,
    sessionId: actor.sessions[0].id,
    roleCode: "ACCOUNTANT",
  };
});

afterAll(async () => database.$disconnect());

function diff(after: string, before: string) {
  return new Decimal(after).minus(before).toFixed(2);
}

describe("account read models on PostgreSQL", () => {
  it("reconciles issued vouchers, dated reversals, advances, and cash-only movements", async () => {
    const filter = {
      customers: { q: label },
      suppliers: { q: label },
      vouchers: { q: label },
    };
    const baseline = (await readAccountWorkspace(database, accountant, filter))
      .summary;

    const actorFields = {
      createdById: accountant.userId,
      updatedById: accountant.userId,
    };
    const buyer = await database.customer.create({
      data: {
        ...actorFields,
        code: `AW-B-${label}`,
        name: `Buyer ${label}`,
        nameKey: `buyer ${label}`,
      },
    });
    const advance = await database.customer.create({
      data: {
        ...actorFields,
        code: `AW-A-${label}`,
        name: `Advance ${label}`,
        nameKey: `advance ${label}`,
      },
    });
    const supplier = await database.supplier.create({
      data: {
        ...actorFields,
        code: `AW-S-${label}`,
        name: `Seller ${label}`,
        nameKey: `seller ${label}`,
      },
    });
    const mine = await database.mine.create({
      data: {
        supplierId: supplier.id,
        name: "Account Mine",
        code: "ACC",
        codeKey: "acc",
        isDefault: true,
      },
    });
    const cash = await database.bank.findUniqueOrThrow({
      where: { nameKey: "cash" },
    });
    const bank = await database.bank.create({
      data: {
        name: `Account Bank ${label}`,
        nameKey: `account bank ${label}`,
        category: "BANK",
      },
    });

    await database.ledgerEntry.createMany({
      data: [
        {
          kind: "CUSTOMER_OPENING",
          customerId: buyer.id,
          businessDate: parseBusinessDate("2008-02-01"),
          amount: "100.25",
          actorId: accountant.userId,
        },
        {
          kind: "SUPPLIER_OPENING",
          supplierId: supplier.id,
          businessDate: parseBusinessDate("2008-02-01"),
          amount: "125.15",
          actorId: accountant.userId,
        },
      ],
    });
    await createOrders(database, accountant, context, {
      key: randomUUID(),
      businessDate: issuedDate,
      rows: [
        {
          customerId: buyer.id,
          supplierId: supplier.id,
          mineId: mine.id,
          vehicleNo: `AW-${label}`,
          weight: "10.005",
          purchaseRate: "3.00",
          sellRate: "4.00",
        },
      ],
    });

    const preview = await readPaymentPartyBalance(
      database,
      accountant,
      "IN",
      buyer.id,
      "2008-02-02",
    );
    expect(preview).toEqual({
      id: buyer.id,
      businessDate: "2008-02-02",
      balance: "100.25",
    });
    const choices = await readAccountFormOptions(
      database,
      accountant,
      "OUT",
      issuedDate,
    );
    expect(choices.banks).toContainEqual({
      id: bank.id,
      name: bank.name,
      category: "BANK",
    });
    expect(choices.parties).toContainEqual({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      balance: "155.17",
    });
    const catalog = await readAccountFormCatalog(database, accountant);
    expect(catalog.payment.parties).toContainEqual({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
    });
    await expect(
      readPaymentPartyBalance(
        database,
        accountant,
        "OUT",
        supplier.id,
        catalog.payment.businessDate,
      ),
    ).resolves.toMatchObject({ balance: "155.17" });

    const issue = (fields: Record<string, unknown>) =>
      createPayment(database, accountant, context, {
        key: randomUUID(),
        businessDate: issuedDate,
        ...fields,
      });
    await issue({
      direction: "IN",
      method: "CASH",
      bankId: cash.id,
      partyId: buyer.id,
      amount: "40.19",
      notes: "Receipt work note",
    });
    await issue({
      direction: "IN",
      method: "ADJUSTMENT",
      partyId: buyer.id,
      amount: "8.01",
      notes: "Account adjustment note",
    });
    await issue({
      direction: "IN",
      method: "CASH",
      bankId: cash.id,
      partyId: advance.id,
      amount: "25.55",
      confirmAdvance: true,
    });
    const { paymentId } = await issue({
      direction: "OUT",
      method: "CHEQUE",
      bankId: bank.id,
      partyId: supplier.id,
      amount: "40.12",
      referenceNo: `Cheque-${label}`,
    });

    const beforeBounce = await readAccountWorkspace(
      database,
      accountant,
      filter,
    );
    expect(diff(beforeBounce.summary.received, baseline.received)).toBe(
      "65.74",
    );
    expect(diff(beforeBounce.summary.paid, baseline.paid)).toBe("40.12");
    expect(
      diff(beforeBounce.summary.balanceInHand, baseline.balanceInHand),
    ).toBe("25.62");
    expect(diff(beforeBounce.summary.receivable, baseline.receivable)).toBe(
      "92.07",
    );
    expect(diff(beforeBounce.summary.payable, baseline.payable)).toBe("115.05");
    expect(
      diff(beforeBounce.summary.unclearedPaid, baseline.unclearedPaid),
    ).toBe("40.12");
    expect(beforeBounce.summary.voucherCount - baseline.voucherCount).toBe(4);
    expect(beforeBounce.customers.rows).toMatchObject([
      {
        id: buyer.id,
        billed: "40.02",
        settled: "40.19",
        balance: "92.07",
        pending: "92.07",
        advance: "0",
      },
      { id: advance.id, balance: "-25.55", pending: "0", advance: "25.55" },
    ]);
    expect(beforeBounce.transactions.rows).toContainEqual(
      expect.objectContaining({
        partyId: buyer.id,
        notes: "Receipt work note",
        direction: "IN",
        bankId: cash.id,
        amount: "40.19",
      }),
    );

    await transitionCheque(database, accountant, context, {
      key: randomUUID(),
      paymentId,
      businessDate: depositDate,
      targetStatus: "DEPOSITED",
    });
    await transitionCheque(database, accountant, context, {
      key: randomUUID(),
      paymentId,
      businessDate: bounceDate,
      targetStatus: "BOUNCED",
      reason: "Cheque returned",
    });
    await database.supplier.update({
      where: { id: supplier.id },
      data: { isActive: false },
    });
    const finished = await readAccountWorkspace(database, accountant, {
      ...filter,
      customers: { ...filter.customers, status: "clear", page: 100 },
      vouchers: {
        ...filter.vouchers,
        direction: "OUT",
        status: "BOUNCED",
        from: issuedDate,
        to: issuedDate,
      },
    });
    expect(finished.customers).toMatchObject({
      page: 1,
      matchedCount: 1,
      rows: [{ id: advance.id }],
    });
    expect(finished.suppliers.rows).toMatchObject([
      {
        id: supplier.id,
        isActive: false,
        billed: "30.02",
        settled: "0.00",
        balance: "155.17",
      },
    ]);
    expect(finished.transactions).toMatchObject({
      matchedCount: 1,
      rows: [{ id: paymentId, status: "BOUNCED", businessDate: issuedDate }],
    });
    expect(diff(finished.summary.paid, baseline.paid)).toBe("0.00");
    expect(diff(finished.summary.unclearedPaid, baseline.unclearedPaid)).toBe(
      "0.00",
    );
    expect(diff(finished.summary.balanceInHand, baseline.balanceInHand)).toBe(
      "65.74",
    );
    expect(diff(finished.summary.payable, baseline.payable)).toBe("155.17");
    expect(
      await readPaymentPartyBalance(database, accountant, "OUT", supplier.id),
    ).toBeNull();
    const datedBounce = await getCashMovementTotals(database, {
      from: bounceDate,
      through: bounceDate,
    });
    expect(datedBounce).toEqual({
      received: "0",
      paid: "-40.12",
      balanceInHand: "40.12",
    });
  });

  it("ranks pending parties by exact numeric amount before formatting", async () => {
    const search = `account sort ${label}`;
    const [small, large] = await Promise.all(
      ["First", "Second"].map((name) =>
        database.customer.create({
          data: {
            code: `AW-${name}-${label}`,
            name: `${search} ${name}`,
            nameKey: `${search} ${name.toLowerCase()}`,
            createdById: accountant.userId,
            updatedById: accountant.userId,
          },
          select: { id: true },
        }),
      ),
    );
    const businessDate = parseBusinessDate("2008-03-01");
    await database.ledgerEntry.createMany({
      data: [
        { customerId: small.id, amount: "2.00" },
        { customerId: large.id, amount: "100.00" },
      ].map((opening) => ({
        ...opening,
        businessDate,
        actorId: accountant.userId,
        kind: "CUSTOMER_OPENING" as const,
      })),
    });

    const { customers } = await readAccountWorkspace(database, accountant, {
      customers: { q: search, status: "pending" },
    });
    expect(customers.rows).toMatchObject([
      { id: large.id, pending: "100.00" },
      { id: small.id, pending: "2.00" },
    ]);
  });

  it("denies account history, payment options and balance previews to Operators", async () => {
    const operator = { ...accountant, roleCode: "OPERATOR" as const };
    await expect(
      readAccountWorkspace(database, operator),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      readAccountFormOptions(database, operator, "IN"),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      readPaymentPartyBalance(database, operator, "OUT", randomUUID()),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
