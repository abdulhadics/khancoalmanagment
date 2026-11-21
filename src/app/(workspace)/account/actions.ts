"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionDenied, requirePermission } from "@/domain/permissions";
import type { PaymentDirection } from "@/generated/prisma/enums";
import { account, type PaymentErrorCode } from "@/i18n/messages/account-en";
import {
  createPayment,
  PaymentCommandError,
  transitionCheque,
  voidPayment,
} from "@/server/account/payments";
import {
  readAccountFormOptions,
  readPaymentPartyBalance,
} from "@/server/account/workspace";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { IdempotencyConflictError } from "@/server/repositories/idempotency";
import { PeriodLockedError } from "@/server/repositories/periods";
import { readDocumentDisplayPreferences } from "@/server/settings/company";
import type { PaymentFormState } from "./form-state";

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): PaymentFormState {
  if (error instanceof PaymentCommandError) {
    const code = Object.hasOwn(account.errors, error.code)
      ? (error.code as PaymentErrorCode)
      : "save";
    return {
      issue: {
        code,
        field: error.field,
        outstanding: error.outstanding,
        excess: error.excess,
      },
    };
  }
  if (error instanceof PermissionDenied) return { issue: { code: "denied" } };
  if (error instanceof PeriodLockedError) return { issue: { code: "closed" } };
  if (error instanceof IdempotencyConflictError)
    return { issue: { code: "conflict" } };
  return { issue: { code: "save" } };
}

function refreshAccount() {
  revalidatePath("/account");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
}

export async function recordPayment(
  direction: PaymentDirection,
  _: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const date = text(form, "businessDate");
  try {
    const result = await createPayment(
      getDatabase(),
      actor,
      await getRequestContext(),
      {
        key: text(form, "key"),
        direction,
        businessDate: date,
        partyId: text(form, "partyId"),
        bankId: text(form, "bankId"),
        method: text(form, "method"),
        amount: text(form, "amount"),
        referenceNo: text(form, "referenceNo"),
        notes: text(form, "notes"),
        confirmAdvance: form.has("confirmAdvance"),
      },
    );
    refreshAccount();
    return { saved: { id: result.paymentId, key: randomUUID(), date } };
  } catch (error) {
    return failure(error);
  }
}

export async function changeVoucher(
  paymentId: string,
  kind: "cheque" | "void",
  _: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  await assertActionOrigin();
  const actor = await requireActor();
  if (!z.uuid().safeParse(paymentId).success)
    return { issue: { code: "invalid" } };
  const fields = {
    paymentId,
    key: text(form, "key"),
    businessDate: text(form, "businessDate"),
    reason: text(form, "reason"),
  };
  try {
    const db = getDatabase();
    const context = await getRequestContext();
    if (kind === "void") await voidPayment(db, actor, context, fields);
    else if (kind === "cheque")
      await transitionCheque(db, actor, context, {
        ...fields,
        targetStatus: text(form, "targetStatus"),
      });
    else return { issue: { code: "invalid" } };
    refreshAccount();
    return { updated: true };
  } catch (error) {
    return failure(error);
  }
}

export async function previewPartyBalance(
  direction: PaymentDirection,
  partyId: string,
  businessDate: string,
) {
  await assertActionOrigin();
  const actor = await requireActor();
  requirePermission(actor, "account.manage");
  try {
    return await readPaymentPartyBalance(
      getDatabase(),
      actor,
      direction,
      partyId,
      businessDate,
    );
  } catch {
    return null;
  }
}

export async function openReceiptForm() {
  await assertActionOrigin();
  const actor = await requireActor();
  requirePermission(actor, "account.manage");
  const db = getDatabase();
  const [options, preferences] = await Promise.all([
    readAccountFormOptions(db, actor, "IN"),
    readDocumentDisplayPreferences(db),
  ]);
  return { options, preferences, key: randomUUID() };
}
