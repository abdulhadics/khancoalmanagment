import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PermissionDenied } from "../../src/domain/permissions";
import { hashPassword } from "../../src/server/auth/password";
import type { SessionActor } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { readDocumentForPrint } from "../../src/server/documents/print-data";
import {
  readDailyDispatch,
  readDispatchSlip,
} from "../../src/server/orders/print";

type Database = ReturnType<typeof makePrisma>;
const now = new Date("2026-11-22T19:03:00.000Z");
const day = "2026-11-23";
const previousDay = "2026-11-22";
const date = new Date(`${day}T00:00:00.000Z`);
const tag = randomBytes(4).toString("hex");
const request = { requestId: randomUUID(), ipAddress: "192.0.2.135" };

async function staff(
  db: Database,
  role: SessionActor["roleCode"],
  suffix = tag,
): Promise<SessionActor> {
  const username = `doc-${role.toLowerCase()}-${suffix}`;
  const user = await db.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: `Print ${role.toLowerCase()}`,
      roleCode: role,
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

describe("dispatch export permissions and accounting snapshots", () => {
  it("retries an adapter serialization conflict with a fresh authorized snapshot", async () => {
    const db = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
    try {
      const accountant = await staff(db, "ACCOUNTANT", `${tag}-retry`);
      let attempts = 0;
      const result = await readDocumentForPrint(
        db,
        accountant,
        "orders.print",
        request,
        now,
        async (tx) => {
          attempts++;
          if (attempts === 1) {
            await tx.$executeRaw`DO $$ BEGIN
              RAISE serialization_failure USING MESSAGE = 'Fixture serialization conflict';
            END $$`;
          }
          return tx.user.findUniqueOrThrow({
            where: { id: accountant.userId },
            select: { id: true },
          });
        },
      );
      expect(result.id).toBe(accountant.userId);
      expect(attempts).toBe(2);
    } finally {
      await db.$disconnect();
    }
  });

  it("uses archived letterhead, scopes day rows, and excludes purchasing fields for Operators", async () => {
    const connection = process.env.INTEGRATION_DATABASE_URL;
    if (!connection)
      throw new Error("Run with an isolated PostgreSQL integration database.");
    const db = makePrisma(connection);
    try {
      const accountant = await staff(db, "ACCOUNTANT");
      const operator = await staff(db, "OPERATOR");
      const viewer = await staff(db, "VIEWER");
      const label = `Print ${tag}`;
      const actorFields = {
        createdById: accountant.userId,
        updatedById: accountant.userId,
      };
      const customer = await db.customer.create({
        data: {
          code: `CUS-P-${tag}`,
          name: label + " Customer",
          nameKey: `print-${tag}-customer`,
          ...actorFields,
        },
      });
      const supplier = await db.supplier.create({
        data: {
          code: `SUP-P-${tag}`,
          name: label + " Supplier",
          nameKey: `print-${tag}-supplier`,
          ...actorFields,
        },
      });
      const mine = await db.mine.create({
        data: {
          supplierId: supplier.id,
          name: "Archive coal mine",
          code: "M-01",
          codeKey: "m-01",
        },
      });
      const archive = await db.documentProfile.create({
        data: {
          name: "Issued prototype letterhead",
          dateFormat: "yyyy-MM-dd",
          weightUnit: "MT",
        },
      });

      async function fixture(
        createdById: string,
        ordinal: bigint,
        businessDate: Date,
      ) {
        return db.$transaction(async (tx) => {
          const fields = {
            businessDate,
            customerId: customer.id,
            supplierId: supplier.id,
            mineId: mine.id,
            vehicleNo: `TST-${ordinal}`,
          };
          const record = await tx.order.create({
            data: {
              ...fields,
              orderNo: `TST-${tag}-${ordinal}`,
              numberYear: businessDate.getUTCFullYear(),
              ordinal,
              status: "POSTED",
              createdById,
              updatedById: createdById,
            },
          });
          await tx.orderRevision.create({
            data: {
              ...fields,
              orderId: record.id,
              revisionNo: 1,
              actorId: createdById,
              documentProfileId: archive.id,
              weight: "10.005",
              purchaseRate: "3.00",
              sellRate: "3.01",
              buyAmount: "30.02",
              sellAmount: "30.12",
              profit: "0.10",
            },
          });
          return tx.order.update({
            where: { id: record.id },
            data: { currentRevisionNo: 1 },
          });
        });
      }

      const sequence = BigInt(`0x${tag}`) + 50_000n;
      const own = await fixture(operator.userId, sequence, date);
      const other = await fixture(accountant.userId, sequence + 1n, date);
      const older = await fixture(
        operator.userId,
        sequence + 2n,
        new Date(`${previousDay}T00:00:00.000Z`),
      );
      const slip = await readDispatchSlip(db, operator, own.id, request, now);
      expect(slip.profile.name).toBe(archive.name);
      expect(slip.profile.weightUnit).toBe("MT");
      expect(slip.row).toMatchObject({
        orderNo: own.orderNo,
        weight: "10.005",
      });
      expect(slip.row.financial).toBeUndefined();
      await expect(
        readDispatchSlip(db, operator, other.id, request, now),
      ).rejects.toMatchObject({ code: "unavailable" });
      await expect(
        readDispatchSlip(db, operator, older.id, request, now),
      ).rejects.toMatchObject({ code: "unavailable" });
      await expect(
        readDispatchSlip(db, viewer, own.id, request, now),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        readDailyDispatch(db, operator, previousDay, request, now),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        readDailyDispatch(db, accountant, "2026-11-31", request, now),
      ).rejects.toMatchObject({ code: "invalidDate" });

      const operational = await readDailyDispatch(
        db,
        operator,
        day,
        request,
        now,
      );
      expect(operational.rows.map((order) => order.orderNo)).toEqual([
        own.orderNo,
      ]);
      expect(operational.financial).toBe(false);
      expect(operational.rows[0].financial).toBeUndefined();
      expect(operational.totals).toEqual({ weight: "10.005" });

      const register = await readDailyDispatch(
        db,
        accountant,
        day,
        request,
        now,
      );
      expect(register.rows.map((order) => order.orderNo)).toEqual([
        own.orderNo,
        other.orderNo,
      ]);
      expect(register.totals).toEqual({
        weight: "20.010",
        buy: "60.04",
        sell: "60.24",
        profit: "0.20",
      });
      expect(
        await db.auditLog.findMany({
          where: {
            requestId: request.requestId,
            action: { in: ["order.slip-print", "order.daily-print"] },
          },
          orderBy: { id: "asc" },
          select: { action: true, outcome: true },
        }),
      ).toEqual([
        { action: "order.slip-print", outcome: "SUCCESS" },
        { action: "order.daily-print", outcome: "SUCCESS" },
        { action: "order.daily-print", outcome: "SUCCESS" },
      ]);
    } finally {
      await db.$disconnect();
    }
  });
});
