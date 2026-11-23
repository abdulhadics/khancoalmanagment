import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { parseMoney } from "@/domain/money";
import { requirePermission } from "@/domain/permissions";
import type { PrismaClient } from "@/generated/prisma/client";
import { ExpenseCategory } from "@/generated/prisma/enums";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  fingerprintCommand,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { lockOpenBusinessMonths, PeriodLockedError } from "../repositories/periods";

export type ExpenseErrorCode =
  | "invalid"
  | "required"
  | "closed"
  | "missing"
  | "alreadyVoided"
  | "denied"
  | "save";

export class ExpenseCommandError extends Error {
  constructor(
    public readonly code: ExpenseErrorCode,
    public readonly field?: string,
  ) {
    super(code);
    this.name = "ExpenseCommandError";
  }
}

const keySchema = z.uuid();
const businessDateSchema = z.string().length(10);
const reasonSchema = z.string().trim().min(1).max(500);

const createExpenseInput = z.strictObject({
  key: keySchema,
  businessDate: businessDateSchema,
  category: z.enum(ExpenseCategory),
  description: z.string().trim().min(1).max(500),
  amount: z.string().trim().min(1).max(64),
  notes: z
    .string()
    .trim()
    .max(1500)
    .nullish()
    .transform((value) => value || null),
});

const voidExpenseInput = z.strictObject({
  key: keySchema,
  expenseId: z.uuid(),
  reason: reasonSchema,
});

type ExpenseRequest = { requestId: string; ipAddress?: string };

function validBusinessDate(value: string, now: Date) {
  try {
    if (value <= todayBusinessDate(now)) return parseBusinessDate(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw new ExpenseCommandError("invalid", "businessDate");
}

function validAmount(amount: string) {
  try {
    const parsed = parseMoney(amount);
    if (parsed.gt(0)) return parsed.toFixed(2);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw new ExpenseCommandError("invalid", "amount");
}

export async function createExpense(
  database: PrismaClient,
  actor: LivePrincipal,
  request: ExpenseRequest,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "expenses.manage");
  const parsed = createExpenseInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ExpenseCommandError(
      issue?.code === "too_small" ? "required" : "invalid",
      String(issue?.path[0] ?? ""),
    );
  }
  const input = parsed.data;
  const date = validBusinessDate(input.businessDate, now);
  const amount = validAmount(input.amount);

  try {
    const result = await runIdempotentCommand(
      database,
      {
        actorId: actor.userId,
        key: input.key,
        operation: "expense.create",
        requestDigest: fingerprintCommand({ ...input, amount }),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => {
        await lockOpenBusinessMonths(tx, [date]);
        const record = await tx.expense.create({
          data: {
            businessDate: date,
            category: input.category,
            description: input.description,
            amount,
            notes: input.notes,
            createdById: actor.userId,
          },
          select: { id: true },
        });

        await appendAuditEvent(tx, {
          ...request,
          actor: { type: "USER", id: actor.userId },
          area: "expenses",
          action: "expense.create",
          targetType: "expense",
          targetId: record.id,
          outcome: "SUCCESS",
          after: {
            businessDate: input.businessDate,
            category: input.category,
            amount,
            description: input.description,
          },
        });

        return { resourceIds: [record.id] };
      },
      (tx) => requireLivePermission(tx, actor, "expenses.manage", now),
    );

    return { id: result.resourceIds[0] };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      throw new ExpenseCommandError("closed", "businessDate");
    }
    throw error;
  }
}

export async function voidExpense(
  database: PrismaClient,
  actor: LivePrincipal,
  request: ExpenseRequest,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "expenses.void");
  const parsed = voidExpenseInput.safeParse(raw);
  if (!parsed.success) {
    throw new ExpenseCommandError("invalid", String(parsed.error.issues[0]?.path[0] ?? ""));
  }
  const input = parsed.data;

  try {
    const result = await runIdempotentCommand(
      database,
      {
        actorId: actor.userId,
        key: input.key,
        operation: "expense.void",
        requestDigest: fingerprintCommand(input),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => {
        const expense = await tx.expense.findUnique({
          where: { id: input.expenseId },
          select: { id: true, businessDate: true, voidedAt: true, amount: true, category: true },
        });
        if (!expense) throw new ExpenseCommandError("missing", "expenseId");
        if (expense.voidedAt) throw new ExpenseCommandError("alreadyVoided", "expenseId");

        await lockOpenBusinessMonths(tx, [expense.businessDate]);
        await tx.expense.update({
          where: { id: input.expenseId },
          data: {
            voidedAt: now,
            voidedById: actor.userId,
            voidReason: input.reason,
          },
        });

        await appendAuditEvent(tx, {
          ...request,
          actor: { type: "USER", id: actor.userId },
          area: "expenses",
          action: "expense.void",
          targetType: "expense",
          targetId: input.expenseId,
          outcome: "SUCCESS",
          before: { voidedAt: null },
          after: { voidedAt: now.toISOString(), voidReason: input.reason },
        });

        return { resourceIds: [input.expenseId] };
      },
      (tx) => requireLivePermission(tx, actor, "expenses.void", now),
    );

    return { id: result.resourceIds[0] };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      throw new ExpenseCommandError("closed", "businessDate");
    }
    throw error;
  }
}
