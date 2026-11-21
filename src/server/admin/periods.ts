import { z } from "zod";
import { parseBusinessDate } from "@/domain/business-date";
import { requirePermission } from "@/domain/permissions";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireLivePermission,
  type LivePrincipal,
} from "@/server/auth/live-principal";
import { appendAuditEvent } from "@/server/repositories/audit-log";
import { lockBusinessMonth } from "@/server/repositories/periods";

const permission = "admin.periods";
export const accountingYear = z.string().regex(/^[1-9][0-9]{3}$/);

const monthNumbers = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);
const periodChangeSchema = z.strictObject({
  year: accountingYear,
  month: z.string().regex(/^(year|0[1-9]|1[0-2])$/),
  operation: z.enum(["lock", "unlock"]),
  reason: z.string().trim().min(1).max(500),
});

type ChangeContext = { requestId: string; ipAddress?: string };

export class PeriodChangeError extends Error {
  constructor(readonly fields: readonly string[]) {
    super("Invalid period change.");
    this.name = "PeriodChangeError";
  }
}

export async function readAccountingYear(
  database: PrismaClient,
  actor: LivePrincipal,
  requestedYear: string,
) {
  requirePermission(actor, permission);
  const year = accountingYear.parse(requestedYear);
  return database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    const stored = await tx.periodLock.findMany({
      where: {
        month: {
          gte: parseBusinessDate(`${year}-01-01`),
          lte: parseBusinessDate(`${year}-12-01`),
        },
      },
      select: {
        month: true,
        isMonthLocked: true,
        isYearLocked: true,
        updatedAt: true,
        updatedBy: { select: { displayName: true } },
      },
    });
    const gates = new Map(
      stored.map((row) => [row.month.toISOString().slice(5, 7), row]),
    );
    return monthNumbers.map((month) => {
      const gate = gates.get(month);
      return {
        month,
        isMonthLocked: gate?.isMonthLocked ?? false,
        isYearLocked: gate?.isYearLocked ?? false,
        updatedAt: gate?.updatedBy ? gate.updatedAt : null,
        updatedBy: gate?.updatedBy?.displayName ?? null,
      };
    });
  });
}

export async function changeAccountingPeriod(
  database: PrismaClient,
  actor: LivePrincipal,
  context: ChangeContext,
  input: unknown,
) {
  requirePermission(actor, permission);
  const parsed = periodChangeSchema.safeParse(input);
  if (!parsed.success) {
    throw new PeriodChangeError(
      parsed.error.issues.map((issue) => String(issue.path[0])),
    );
  }

  const { year, month, operation, reason } = parsed.data;
  const scope = month === "year" ? year : `${year}-${month}`;
  const targetMonths = month === "year" ? monthNumbers : [month];
  const lockField = month === "year" ? "isYearLocked" : "isMonthLocked";
  const locked = operation === "lock";

  return database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    const changedMonths: string[] = [];
    const previouslyLocked: string[] = [];

    // Use the same lock and chronological ordering as financial postings.
    for (const number of targetMonths) {
      const key = `${year}-${number}-01`;
      const gate = await lockBusinessMonth(tx, key);
      if (gate[lockField]) previouslyLocked.push(number);
      if (gate[lockField] === locked) continue;
      changedMonths.push(number);
      await tx.periodLock.update({
        where: { month: parseBusinessDate(key) },
        data: { [lockField]: locked, updatedById: actor.userId },
      });
    }

    if (!changedMonths.length) return { scope, locked, changed: false };

    await appendAuditEvent(tx, {
      ...context,
      actor: { type: "USER", id: actor.userId },
      area: "administration",
      action: `period.${operation}`,
      targetType: month === "year" ? "accounting-year" : "accounting-month",
      targetId: scope,
      outcome: "SUCCESS",
      before: { lockedMonths: previouslyLocked.join(", ") },
      after: {
        lockedMonths: locked ? targetMonths.join(", ") : "",
        affectedMonths: changedMonths.join(", "),
        reason,
      },
    });
    return { scope, locked, changed: true };
  });
}
