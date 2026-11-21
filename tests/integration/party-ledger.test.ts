import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBusinessDate } from "../../src/domain/business-date";
import { createPayment } from "../../src/server/account/payments";
import type { LivePrincipal } from "../../src/server/auth/live-principal";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";
import {
  parsePartyLedgerFilters,
  readPartyLedger,
} from "../../src/server/details/party-ledger";
import { createOrders } from "../../src/server/orders/create";
import { ReportPeriodError } from "../../src/server/reporting/period";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const request = { requestId: randomUUID() };
const label = randomBytes(7).toString("hex");
let accountant: LivePrincipal;
let customerId: string;
let supplierId: string;

beforeAll(async () => {
  const now = new Date();
  const username = `ledger-${label}`;
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  const actor = await database.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Ledger fixture",
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
  const audit = { createdById: actor.id, updatedById: actor.id };
  const customer = await database.customer.create({
    data: {
      ...audit,
      code: `LD-C-${label}`,
      name: `Buyer ${label}`,
      nameKey: `buyer ${label}`,
    },
  });
  const supplier = await database.supplier.create({
    data: {
      ...audit,
      code: `LD-S-${label}`,
      name: `Supplier ${label}`,
      nameKey: `supplier ${label}`,
    },
  });
  customerId = customer.id;
  supplierId = supplier.id;
  const mine = await database.mine.create({
    data: {
      supplierId,
      name: "Ledger Mine",
      code: "LD",
      codeKey: "ld",
      isDefault: true,
    },
  });
  const bank = await database.bank.findUniqueOrThrow({
    where: { nameKey: "cash" },
  });
  const initialDate = parseBusinessDate("2008-08-01");
  await database.ledgerEntry.createMany({
    data: [
      {
        kind: "CUSTOMER_OPENING",
        customerId,
        businessDate: initialDate,
        amount: "95.50",
        actorId: actor.id,
      },
      {
        kind: "SUPPLIER_OPENING",
        supplierId,
        businessDate: initialDate,
        amount: "5.50",
        actorId: actor.id,
      },
    ],
  });
  const businessDate = "2008-08-02";
  await createOrders(database, accountant, request, {
    key: randomUUID(),
    businessDate,
    rows: [
      {
        customerId,
        supplierId,
        mineId: mine.id,
        vehicleNo: `LD-${label}`,
        weight: "10.005",
        purchaseRate: "3.00",
        sellRate: "4.00",
      },
    ],
  });
  await createPayment(database, accountant, request, {
    key: randomUUID(),
    direction: "IN",
    method: "CASH",
    bankId: bank.id,
    partyId: customerId,
    businessDate,
    amount: "10.09",
    referenceNo: `Receipt-${label}`,
  });
  await createPayment(database, accountant, request, {
    key: randomUUID(),
    direction: "OUT",
    method: "CASH",
    bankId: bank.id,
    partyId: supplierId,
    businessDate,
    amount: "10.01",
  });
  await database.ledgerEntry.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      kind: "CUSTOMER_ADJUSTMENT",
      customerId,
      actorId: actor.id,
      amount: "-1.00",
      reason: "Test allocation",
      businessDate: parseBusinessDate(
        `2008-08-${String(index + 3).padStart(2, "0")}`,
      ),
    })),
  });
  await database.customer.update({
    where: { id: customerId },
    data: { isActive: false },
  });
});

afterAll(async () => database.$disconnect());

const period = {
  year: "2008",
  month: "8",
  from: "2008-08-02",
  to: "2008-08-12",
  pageSize: "10",
  sort: "date-asc",
};

describe("party ledger details on PostgreSQL", () => {
  it("keeps opening, closing and running balances exact across date filters and pages", async () => {
    const first = await readPartyLedger(
      database,
      "customer",
      parsePartyLedgerFilters({ ...period, partyId: customerId }),
    );
    expect(first).toMatchObject({
      party: { id: customerId, isActive: false },
      page: 1,
      lastPage: 2,
      matchedCount: 12,
      summary: {
        openingBalance: "95.50",
        billed: "40.02",
        settled: "10.09",
        adjustments: "-10.00",
        activity: "19.93",
        closingBalance: "115.43",
        pending: "115.43",
        advance: "0.00",
        entryCount: 12,
        trucks: 1,
        weight: "10.005",
      },
    });
    expect(first?.rows[0]).toMatchObject({
      kind: "ORDER_SALE",
      businessDate: "2008-08-02",
      rate: "4.00",
      weight: "10.005",
      debit: "40.02",
      balance: "135.52",
      canPrintOrder: true,
    });
    expect(first?.rows[1]).toMatchObject({
      kind: "CUSTOMER_RECEIPT",
      businessDate: "2008-08-02",
      paymentMethod: "CASH",
      credit: "10.09",
      balance: "125.43",
    });
    const second = await readPartyLedger(
      database,
      "customer",
      parsePartyLedgerFilters({ ...period, partyId: customerId, page: "2" }),
    );
    expect(second).toMatchObject({
      summary: first?.summary,
      page: 2,
      matchedCount: 12,
    });
    expect(second?.rows.map(({ balance }) => balance)).toEqual([
      "116.43",
      "115.43",
    ]);
  });

  it("filters by source and text after calculating chronological balances, including on exports", async () => {
    const filters = parsePartyLedgerFilters(
      new URLSearchParams({
        ...period,
        partyId: customerId,
        tab: "payments",
        q: `Receipt-${label}`,
        sort: "amount-desc",
        page: "9",
      }),
    );
    const result = await readPartyLedger(database, "customer", filters, 30);
    expect(result).toMatchObject({
      page: 1,
      matchedCount: 1,
      rows: [{ kind: "CUSTOMER_RECEIPT", balance: "125.43" }],
      summary: { entryCount: 12, closingBalance: "115.43" },
    });
    const supplier = await readPartyLedger(
      database,
      "supplier",
      parsePartyLedgerFilters({
        ...period,
        partyId: supplierId,
        tab: "orders",
      }),
    );
    expect(supplier).toMatchObject({
      matchedCount: 1,
      summary: {
        openingBalance: "5.50",
        billed: "30.02",
        settled: "10.01",
        closingBalance: "25.51",
      },
      rows: [{ kind: "ORDER_PURCHASE", rate: "3.00", balance: "35.52" }],
    });
    expect(() =>
      parsePartyLedgerFilters({ ...period, month: "9", partyId: customerId }),
    ).toThrow(ReportPeriodError);
    await expect(
      readPartyLedger(
        database,
        "customer",
        parsePartyLedgerFilters({ partyId: randomUUID() }),
      ),
    ).resolves.toBeNull();
  });
});
