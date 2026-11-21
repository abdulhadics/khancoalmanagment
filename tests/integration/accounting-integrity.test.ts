import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PermissionDenied } from "../../src/domain/permissions";
import { makePrisma } from "../../src/server/db/connect";
import { readAccountingIntegrity } from "../../src/server/reporting/reconciliation";
import { reserveNumberBlock } from "../../src/server/repositories/number-sequences";

const db = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
afterAll(() => db.$disconnect());

describe("accounting integrity", () => {
  it("restricts integrity results to the Owner", async () => {
    await expect(
      readAccountingIntegrity(db, {
        roleCode: "ACCOUNTANT",
        userId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("detects a missing voucher posting and accepts its balanced counterpart", async () => {
    const suffix = randomUUID().slice(0, 8);
    const invalid = `CHECK-${suffix}-MISSING`;
    const valid = `CHECK-${suffix}-BALANCED`;
    const rollback = new Error("Discard the synthetic integrity fixtures");
    await expect(db.$transaction(async (tx) => {
      const staff = await tx.user.create({
        data: {
          username: `integrity-${suffix}`,
          email: `integrity-${suffix}@example.test`,
          displayName: "Integrity fixture",
          roleCode: "ACCOUNTANT",
        },
      });
      const customer = await tx.customer.create({
        data: {
          code: `CHECK-${suffix}`,
          name: "Integrity fixture",
          nameKey: "integrity fixture",
          createdById: staff.id,
          updatedById: staff.id,
        },
      });
      const company = await tx.companySettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const { firstOrdinal } = await reserveNumberBlock(tx, "VOUCHER", 0, 2);
      const businessDate = new Date("2026-01-06T00:00:00Z");
      const defaults = {
        businessDate,
        amount: "11.15",
        customerId: customer.id,
        createdById: staff.id,
        documentProfileId: company.documentProfileId,
        direction: "IN",
        method: "ADJUSTMENT",
        status: "POSTED",
        notes: "Reconciliation fixture",
      } as const;
      await tx.payment.create({
        data: { ...defaults, voucherNo: invalid, ordinal: firstOrdinal },
      });
      const payment = await tx.payment.create({
        data: { ...defaults, voucherNo: valid, ordinal: firstOrdinal + 1n },
      });
      await tx.ledgerEntry.create({
        data: {
          kind: "CUSTOMER_RECEIPT",
          businessDate,
          amount: "-11.15",
          customerId: customer.id,
          paymentId: payment.id,
          actorId: staff.id,
        },
      });
      const result = await readAccountingIntegrity(tx, {
        roleCode: "OWNER",
        userId: randomUUID(),
      });
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.findings).toContainEqual({ kind: "payment", subject: invalid });
      expect(result.findings).not.toContainEqual({ kind: "payment", subject: valid });
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
