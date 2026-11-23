"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { PermissionDenied } from "@/domain/permissions";
import {
  createExpense,
  voidExpense,
  ExpenseCommandError,
  type ExpenseErrorCode,
} from "@/server/expenses/mutations";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { PeriodLockedError } from "@/server/repositories/periods";

export type ActionState = {
  success?: boolean;
  error?: ExpenseErrorCode | "unknown";
  field?: string;
};

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

export async function saveExpenseAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await assertActionOrigin();
  const actor = await requireActor();

  try {
    const db = getDatabase();
    const context = await getRequestContext();

    await createExpense(db, actor, context, {
      key: text(form, "key") || randomUUID(),
      businessDate: text(form, "businessDate"),
      category: text(form, "category"),
      description: text(form, "description"),
      amount: text(form, "amount"),
      notes: text(form, "notes"),
    });

    revalidatePath("/expenses");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    if (err instanceof ExpenseCommandError) {
      return { error: err.code, field: err.field };
    }
    if (err instanceof PermissionDenied) {
      return { error: "denied" };
    }
    if (err instanceof PeriodLockedError) {
      return { error: "closed" };
    }
    return { error: "save" };
  }
}

export async function voidExpenseAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await assertActionOrigin();
  const actor = await requireActor();

  try {
    const db = getDatabase();
    const context = await getRequestContext();

    await voidExpense(db, actor, context, {
      key: text(form, "key") || randomUUID(),
      expenseId: text(form, "expenseId"),
      reason: text(form, "reason"),
    });

    revalidatePath("/expenses");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    if (err instanceof ExpenseCommandError) {
      return { error: err.code, field: err.field };
    }
    if (err instanceof PermissionDenied) {
      return { error: "denied" };
    }
    if (err instanceof PeriodLockedError) {
      return { error: "closed" };
    }
    return { error: "save" };
  }
}
