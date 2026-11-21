import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PermissionDenied } from "../../src/domain/permissions";
import {
  createPayment,
  transitionCheque,
} from "../../src/server/account/payments";
import { readPaymentVoucher } from "../../src/server/account/voucher";
import { hashPassword } from "../../src/server/auth/password";
import type { SessionActor } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";

const now = new Date("2042-05-03T19:03:00Z");
type Database = ReturnType<typeof makePrisma>;

async function staff(
  db: Database,
  roleCode: SessionActor["roleCode"],
): Promise<SessionActor> {
  const username = `voucher-${randomUUID()}`;
  const user = await db.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Voucher Test Staff",
      roleCode,
      credential: {
        create: {
          passwordHash: await hashPassword(
            randomBytes(32).toString("base64url"),
          ),
          mustChangePassword: false,
        },
      },
    },
  });
  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenDigest: randomBytes(32).toString("hex"),
      issuedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });
  return {
    sessionId: session.id,
    userId: user.id,
    roleCode: user.roleCode,
    username,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
  };
}

describe("printable vouchers on PostgreSQL", () => {
  it("prints the posted profile, exact amount and latest dated status to authorized staff", async () => {
    const url = process.env.INTEGRATION_DATABASE_URL;
    if (!url)
      throw new Error("Run this test with the isolated PostgreSQL database.");
    const db = makePrisma(url);
    const context = { requestId: randomUUID(), ipAddress: "192.0.2.191" };
    let restoreProfile: string | undefined;
    try {
      const accountant = await staff(db, "ACCOUNTANT");
      const operator = await staff(db, "OPERATOR");
      const viewer = await staff(db, "VIEWER");
      const tag = randomBytes(5).toString("hex");
      const customer = await db.customer.create({
        data: {
          code: `CUS-V-${tag}`,
          name: "Voucher Test Customer",
          nameKey: `voucher-customer-${tag}`,
          createdById: accountant.userId,
          updatedById: accountant.userId,
        },
      });
      const supplier = await db.supplier.create({
        data: {
          code: `SUP-V-${tag}`,
          name: "Voucher Test Supplier",
          nameKey: `voucher-supplier-${tag}`,
          createdById: accountant.userId,
          updatedById: accountant.userId,
        },
      });
      const bank = await db.bank.create({
        data: {
          name: `Clearing Bank ${tag}`,
          nameKey: `clearing bank ${tag}`,
          category: "BANK",
        },
      });
      const issuedProfile = await db.companySettings.findUniqueOrThrow({
        where: { id: 1 },
        select: { documentProfile: { select: { id: true, name: true } } },
      });
      const payment = {
        bankId: bank.id,
        businessDate: "2042-05-01",
        amount: "1498220.00",
        referenceNo: "CHQ-V0001",
        notes: "Receipt for dispatches",
        confirmAdvance: true,
      };
      const receipt = await createPayment(
        db,
        accountant,
        context,
        {
          ...payment,
          key: randomUUID(),
          direction: "IN",
          method: "CHEQUE",
          partyId: customer.id,
        },
        now,
      );
      const outgoing = await createPayment(
        db,
        accountant,
        context,
        {
          ...payment,
          key: randomUUID(),
          direction: "OUT",
          method: "BANK_TRANSFER",
          partyId: supplier.id,
          referenceNo: "BANK-V0002",
        },
        now,
      );
      await transitionCheque(
        db,
        accountant,
        context,
        {
          key: randomUUID(),
          paymentId: receipt.paymentId,
          businessDate: "2042-05-02",
          targetStatus: "DEPOSITED",
        },
        now,
      );
      await transitionCheque(
        db,
        accountant,
        context,
        {
          key: randomUUID(),
          paymentId: receipt.paymentId,
          businessDate: "2042-05-03",
          targetStatus: "BOUNCED",
          reason: "Cheque returned",
        },
        now,
      );

      const newProfile = await db.documentProfile.create({
        data: { name: "Replacement print identity" },
      });
      await db.companySettings.update({
        where: { id: 1 },
        data: { documentProfileId: newProfile.id },
      });
      restoreProfile = issuedProfile.documentProfile.id;
      await db.bank.update({
        where: { id: bank.id },
        data: { name: `New bank ${tag}`, nameKey: `new bank ${tag}` },
      });

      const printed = await readPaymentVoucher(
        db,
        accountant,
        receipt.paymentId,
        context,
        now,
      );
      expect(printed).toMatchObject({
        profile: { name: issuedProfile.documentProfile.name },
        date: new Date("2042-05-01T00:00:00Z"),
        statusDate: new Date("2042-05-03T00:00:00Z"),
        amount: "1498220.00",
        bankName: bank.name,
        referenceNo: payment.referenceNo,
        party: { code: customer.code, name: customer.name },
        direction: "IN",
        status: "BOUNCED",
        method: "CHEQUE",
      });
      await expect(
        readPaymentVoucher(db, accountant, outgoing.paymentId, context, now),
      ).resolves.toMatchObject({
        direction: "OUT",
        status: "POSTED",
        party: { code: supplier.code, name: supplier.name },
      });
      for (const denied of [operator, viewer]) {
        await expect(
          readPaymentVoucher(db, denied, receipt.paymentId, context, now),
        ).rejects.toBeInstanceOf(PermissionDenied);
      }
      await expect(
        readPaymentVoucher(db, accountant, "not-an-id", context, now),
      ).resolves.toBeNull();
      await expect(
        readPaymentVoucher(db, accountant, randomUUID(), context, now),
      ).resolves.toBeNull();
      expect(
        await db.auditLog.findMany({
          where: {
            requestId: context.requestId,
            action: "payment.voucher-print",
          },
          orderBy: { id: "asc" },
          select: { actorId: true, targetId: true, after: true },
        }),
      ).toEqual([
        {
          actorId: accountant.userId,
          targetId: receipt.paymentId,
          after: { status: "BOUNCED" },
        },
        {
          actorId: accountant.userId,
          targetId: outgoing.paymentId,
          after: { status: "POSTED" },
        },
      ]);
    } finally {
      try {
        if (restoreProfile)
          await db.companySettings.update({
            where: { id: 1 },
            data: { documentProfileId: restoreProfile },
          });
      } finally {
        await db.$disconnect();
      }
    }
  });
});
