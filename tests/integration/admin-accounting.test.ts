import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBusinessDate } from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import type { RoleCode } from "../../src/generated/prisma/client";
import { createPayment, voidPayment } from "../../src/server/account/payments";
import {
  parseAuditFilters,
  readAuditTimeline,
} from "../../src/server/admin/audit";
import {
  parseIntegrityPeriod,
  runAdminIntegrityCheck,
} from "../../src/server/admin/integrity";
import {
  changeAccountingPeriod,
  readAccountingYear,
} from "../../src/server/admin/periods";
import type { LivePrincipal } from "../../src/server/auth/live-principal";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const ipAddress = "192.0.2.22";
const context = { requestId: randomUUID(), ipAddress };
let owner: LivePrincipal;
let accountant: LivePrincipal;

async function staff(roleCode: RoleCode) {
  const name = `admin-${randomUUID()}`;
  const user = await database.user.create({
    data: {
      username: name,
      email: `${name}@example.test`,
      displayName: `Admin test ${roleCode}`,
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
  });
  const token = await database.$transaction((tx) => issueSession(tx, user.id));
  const principal = await getSession(token, database);
  if (!principal)
    throw new Error("Could not start an administration fixture session.");
  return principal;
}

beforeAll(async () => {
  owner = await staff("OWNER");
  accountant = await staff("ACCOUNTANT");
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

describe("accounting administration", () => {
  it("denies other roles and checks live sessions for Owner controls", async () => {
    const change = {
      year: "1991",
      month: "01",
      operation: "lock",
      reason: "Approval",
    };
    const forged = { ...accountant, roleCode: "OWNER" } as const;
    for (const unauthorized of [accountant, forged]) {
      await expect(
        readAccountingYear(database, unauthorized, "1991"),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        changeAccountingPeriod(database, unauthorized, context, change),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        readAuditTimeline(database, unauthorized, {}),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        runAdminIntegrityCheck(
          database,
          unauthorized,
          parseIntegrityPeriod({}),
        ),
      ).rejects.toBeInstanceOf(PermissionDenied);
    }
  });

  it("keeps month locks when reopening a year and writes reasoned audit events", async () => {
    const change = (month: string, operation: string, reason: string) =>
      changeAccountingPeriod(database, owner, context, {
        year: "1992",
        month,
        operation,
        reason,
      });
    await expect(
      change("02", "lock", "February reviewed"),
    ).resolves.toMatchObject({ changed: true });
    await expect(
      change("year", "lock", "Year-end close"),
    ).resolves.toMatchObject({ changed: true });
    await expect(change("year", "unlock", " ")).rejects.toMatchObject({
      fields: ["reason"],
    });
    const locked = await readAccountingYear(database, owner, "1992");
    expect(locked.every((month) => month.isYearLocked)).toBe(true);
    await expect(
      change("year", "unlock", "Reconcile tax adjustment"),
    ).resolves.toMatchObject({ changed: true });
    await expect(
      change("year", "unlock", "Already reopened"),
    ).resolves.toMatchObject({ changed: false });
    const reopened = await readAccountingYear(database, owner, "1992");
    expect(reopened.every((month) => !month.isYearLocked)).toBe(true);
    expect(
      reopened
        .filter((month) => month.isMonthLocked)
        .map((month) => month.month),
    ).toEqual(["02"]);

    const result = await readAuditTimeline(database, owner, {
      action: "period.unlock",
      actor: owner.userId,
      outcome: "SUCCESS",
    });
    expect(
      result.events.find((event) => event.targetId === "1992"),
    ).toMatchObject({
      actorName: "Admin test OWNER",
      ipAddress,
      requestId: context.requestId,
      before: {
        lockedMonths: "01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12",
      },
      after: {
        lockedMonths: "",
        affectedMonths: "01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12",
        reason: "Reconcile tax adjustment",
      },
    });
    expect(
      result.events.filter((event) => event.targetId === "1992"),
    ).toHaveLength(1);
  });

  it("rejects a locked receipt atomically and reconciles it after an Owner reopens the month", async () => {
    const suffix = randomUUID().slice(0, 10);
    const { userId } = accountant;
    const customer = await database.customer.create({
      data: {
        code: `TEST-${suffix}`,
        name: `Admin check ${suffix}`,
        nameKey: `admin check ${suffix}`,
        createdById: userId,
        updatedById: userId,
      },
    });
    const cash = await database.bank.create({
      data: {
        name: `Cash ${suffix}`,
        nameKey: `cash ${suffix}`,
        category: "CASH",
      },
    });
    await database.ledgerEntry.create({
      data: {
        kind: "CUSTOMER_OPENING",
        customerId: customer.id,
        actorId: userId,
        amount: "55.40",
        businessDate: parseBusinessDate("1989-02-02"),
      },
    });
    const period = {
      year: "1989",
      month: "03",
      reason: "Receipt reconciliation",
    };
    const input = {
      key: randomUUID(),
      direction: "IN",
      partyId: customer.id,
      method: "CASH",
      bankId: cash.id,
      businessDate: "1989-03-02",
      amount: "14.29",
    };
    await changeAccountingPeriod(database, owner, context, {
      ...period,
      operation: "lock",
    });
    await expect(
      createPayment(database, accountant, context, input),
    ).rejects.toMatchObject({ code: "closed" });
    expect(
      await database.payment.count({ where: { customerId: customer.id } }),
    ).toBe(0);
    expect(
      await database.ledgerEntry.count({ where: { customerId: customer.id } }),
    ).toBe(1);
    await changeAccountingPeriod(database, owner, context, {
      ...period,
      operation: "unlock",
    });
    const { paymentId } = await createPayment(
      database,
      accountant,
      context,
      input,
    );
    try {
      const result = await runAdminIntegrityCheck(
        database,
        owner,
        parseIntegrityPeriod({ from: "1989-03-01", to: "1989-03-02" }),
      );
      expect(
        result.balances.find((row) => row.party === "customer"),
      ).toMatchObject({
        opening: "55.40",
        settled: "14.29",
        closing: "41.11",
        reportedClosing: "41.11",
        matches: true,
      });
    } finally {
      // The integration suite shares a disposable database across files.
      await voidPayment(database, owner, context, {
        paymentId,
        key: randomUUID(),
        businessDate: "1989-03-03",
        reason: "Close out the test receipt",
      });
      await database.ledgerEntry.create({
        data: {
          kind: "CUSTOMER_ADJUSTMENT",
          customerId: customer.id,
          actorId: owner.userId,
          amount: "-55.40",
          businessDate: parseBusinessDate("1989-03-03"),
          reason: "Close out the test opening balance",
        },
      });
    }
  });

  it("pages tied audit events by ID and filters the full Karachi day without leaking snapshots", async () => {
    const action = `admin.test.${randomUUID()}`;
    const fixture = {
      actorType: "SYSTEM",
      area: "test",
      action,
      outcome: "SUCCESS",
      targetType: "fixture",
      requestId: context.requestId,
      ipAddress,
      after: {
        count: 2,
        email: "hidden@example.test",
        nested: { token: "hidden" },
        totpKeyId: "hidden",
      },
    } as const;
    await database.auditLog.createMany({
      data: [
        {
          ...fixture,
          occurredAt: new Date("2003-03-04T18:59:59.999Z"),
          targetId: "excluded-previous-day",
        },
        ...Array.from({ length: 27 }, (_, index) => ({
          ...fixture,
          occurredAt: new Date("2003-03-04T19:00:00.000Z"),
          targetId: String(index),
        })),
        {
          ...fixture,
          occurredAt: new Date("2003-03-05T19:00:00.000Z"),
          targetId: "excluded-next-day",
        },
      ],
    });
    const filters = {
      actor: "SYSTEM",
      action,
      from: "2003-03-05",
      to: "2003-03-05",
    };
    const parsed = parseAuditFilters(filters);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Invalid audit fixture query.");
    const first = await readAuditTimeline(database, owner, parsed.data);
    expect(first.events).toHaveLength(25);
    expect(first.events[0].occurredAt).toEqual(
      new Date("2003-03-04T19:00:00.000Z"),
    );
    expect(
      first.events.every(
        ({ after }) => JSON.stringify(after) === '{"count":2}',
      ),
    ).toBe(true);
    expect(first.older).toBe(first.events[24].id);
    const next = await readAuditTimeline(database, owner, {
      ...parsed.data,
      before: first.older ?? undefined,
    });
    expect(next.events).toHaveLength(2);
    expect(
      new Set([...first.events, ...next.events].map((event) => event.id)).size,
    ).toBe(27);
    expect(next.older).toBeNull();
    expect(parseAuditFilters({ before: "bogus" }).success).toBe(false);
  });
});
