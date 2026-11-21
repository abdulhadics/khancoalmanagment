import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPayment } from "../../src/server/account/payments";
import { loginWithPassword } from "../../src/server/auth/login";
import { hashPassword } from "../../src/server/auth/password";
import { getSession, type SessionActor } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { exportDetails } from "../../src/server/details/exports";
import { createOrders } from "../../src/server/orders/create";

const now = new Date("2043-05-03T19:03:00.000Z");
const date = "2043-05-03";
type Database = ReturnType<typeof makePrisma>;

async function testActor(db: Database, roleCode: SessionActor["roleCode"]) {
  const username = `export-${randomUUID()}`;
  const password = randomBytes(32).toString("base64url");
  await db.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Export Test Staff",
      roleCode,
      credential: {
        create: {
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
        },
      },
    },
  });
  const login = await loginWithPassword(
    { identifier: username, password, requestId: randomUUID() },
    db,
    { now, production: false },
  );
  const actor =
    login.status === "success" ? await getSession(login.token, db, now) : null;
  if (!actor) throw new Error("Expected an authenticated test staff account.");
  return actor;
}

describe("detail exports on PostgreSQL", () => {
  it("preserves filtered row order, authenticates each ledger and agrees with chronological balance", async () => {
    const connection = process.env.INTEGRATION_DATABASE_URL;
    if (!connection)
      throw new Error("Run with the isolated PostgreSQL test database.");
    const db = makePrisma(connection);
    const context = { requestId: randomUUID(), ipAddress: "192.0.2.206" };
    try {
      const accountant = await testActor(db, "ACCOUNTANT");
      const viewer = await testActor(db, "VIEWER");
      const tag = randomBytes(5).toString("hex");
      const actorFields = {
        createdById: accountant.userId,
        updatedById: accountant.userId,
      };
      const customer = await db.customer.create({
        data: {
          code: `CUS-X-${tag}`,
          name: '=Sample "Metals", Lahore',
          nameKey: `export-metal-${tag}`,
          ...actorFields,
        },
      });
      const supplier = await db.supplier.create({
        data: {
          code: `SUP-X-${tag}`,
          name: "Sample Coals",
          nameKey: `export-coal-${tag}`,
          ...actorFields,
        },
      });
      const mine = await db.mine.create({
        data: {
          supplierId: supplier.id,
          code: "M-07",
          codeKey: "m-07",
          name: "Sample Mine",
        },
      });
      const cash = await db.bank.create({
        data: {
          name: `Export Cash ${tag}`,
          nameKey: `export cash ${tag}`,
          category: "CASH",
        },
      });
      const order = {
        customerId: customer.id,
        supplierId: supplier.id,
        mineId: mine.id,
        weight: "10.005",
        purchaseRate: "3.00",
        sellRate: "3.01",
      };
      const current = await createOrders(
        db,
        accountant,
        context,
        {
          key: randomUUID(),
          businessDate: date,
          rows: [{ ...order, vehicleNo: "SAM-781" }],
        },
        now,
      );
      const prior = await createOrders(
        db,
        accountant,
        context,
        {
          key: randomUUID(),
          businessDate: "2043-05-02",
          rows: [{ ...order, vehicleNo: "SAM-782" }],
        },
        now,
      );
      const [currentRow, priorRow] = await Promise.all([
        db.order.findUniqueOrThrow({ where: { id: current.orderIds[0] } }),
        db.order.findUniqueOrThrow({ where: { id: prior.orderIds[0] } }),
      ]);
      const receipt = await createPayment(
        db,
        accountant,
        context,
        {
          key: randomUUID(),
          businessDate: date,
          direction: "IN",
          partyId: customer.id,
          method: "CASH",
          bankId: cash.id,
          amount: "10.50",
        },
        now,
      );
      const voucher = await db.payment.findUniqueOrThrow({
        where: { id: receipt.paymentId },
      });

      const sales = await exportDetails(
        db,
        accountant,
        "sales",
        new URLSearchParams({
          format: "csv",
          customerId: customer.id,
          from: date,
          to: date,
          page: "9",
          pageSize: "10",
          sort: "orderNo",
          direction: "asc",
        }),
        context,
        now,
      );
      expect(sales.status).toBe(200);
      expect(sales.headers.get("Content-Disposition")).toBe(
        'attachment; filename="sales-details.csv"',
      );
      const salesCsv = await sales.text();
      expect(salesCsv).toContain(`"${currentRow.orderNo}"`);
      expect(salesCsv).not.toContain(priorRow.orderNo);
      expect(salesCsv).toContain('"\t=Sample ""Metals"", Lahore"');
      expect(salesCsv).toContain("10.005,3.00,30.02,3.01,30.12,0.10\r\n");

      const ledger = await exportDetails(
        db,
        accountant,
        "customer",
        new URLSearchParams({
          format: "csv",
          partyId: customer.id,
          from: date,
          to: date,
          tab: "payments",
        }),
        context,
        now,
      );
      expect(ledger.status).toBe(200);
      const ledgerCsv = await ledger.text();
      expect(ledgerCsv).toContain(voucher.voucherNo);
      expect(ledgerCsv).not.toContain(currentRow.orderNo);
      expect(ledgerCsv).toContain("0,10.50,49.74\r\n");
      expect(ledgerCsv).toMatch(/"Opening balance".*30\.12\r\n/);
      expect(ledgerCsv).toMatch(/"Closing balance".*49\.74\r\n/);

      const supplierPdf = await exportDetails(
        db,
        accountant,
        "supplier",
        new URLSearchParams({
          format: "pdf",
          partyId: supplier.id,
          from: date,
          to: date,
          tab: "orders",
        }),
        context,
        now,
      );
      expect(supplierPdf.status).toBe(200);
      expect(supplierPdf.headers.get("Content-Type")).toBe("application/pdf");
      expect(
        Buffer.from(await supplierPdf.arrayBuffer()).toString("latin1"),
      ).toMatch(/^%PDF-/);

      const denied = await exportDetails(
        db,
        viewer,
        "sales",
        new URLSearchParams({ format: "csv" }),
        context,
        now,
      );
      expect(denied.status).toBe(404);
      const invalid = await exportDetails(
        db,
        accountant,
        "sales",
        new URLSearchParams("format=csv&format=pdf"),
        context,
        now,
      );
      expect(invalid.status).toBe(400);
      const missing = await exportDetails(
        db,
        accountant,
        "customer",
        new URLSearchParams({ format: "pdf" }),
        context,
        now,
      );
      expect(missing.status).toBe(404);
      expect(
        await db.auditLog.findMany({
          where: { requestId: context.requestId, action: "details.export" },
          orderBy: { id: "asc" },
          select: { targetType: true, after: true },
        }),
      ).toEqual([
        { targetType: "sales_details", after: { format: "csv", records: 1 } },
        { targetType: "customer_ledger", after: { format: "csv", records: 1 } },
        { targetType: "supplier_ledger", after: { format: "pdf", records: 1 } },
      ]);
    } finally {
      await db.$disconnect();
    }
  });
});
