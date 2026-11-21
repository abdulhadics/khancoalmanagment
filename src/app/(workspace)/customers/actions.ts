"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PermissionDenied } from "@/domain/permissions";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import {
  CustomerError,
  createCustomer,
  updateCustomer,
} from "@/server/customers";
import { getDatabase } from "@/server/db/client";
import { IdempotencyConflictError } from "@/server/repositories/idempotency";
import { PeriodLockedError } from "@/server/repositories/periods";

export type CustomerFormState = {
  error?: CustomerError["code"] | "locked" | "conflict" | "save";
  fields?: string[];
  values?: Record<string, string>;
};

const limits = {
  name: 160,
  industry: 120,
  contactPerson: 120,
  phone: 12,
  email: 254,
  city: 120,
  address: 500,
  notes: 1500,
  creditLimit: 64,
  openingAmount: 64,
  openingDate: 10,
  status: 10,
} as const;

async function submitCustomer(
  form: FormData,
  id?: string,
): Promise<CustomerFormState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const context = await getRequestContext();
  const database = getDatabase();
  const input = Object.fromEntries(
    Object.keys(limits).map((key) => [key, form.get(key) ?? ""]),
  );
  const values = Object.fromEntries(
    Object.entries(limits).map(([key, limit]) => {
      const value = input[key];
      return [key, typeof value === "string" ? value.slice(0, limit) : ""];
    }),
  );
  const payload = {
    ...input,
    requestKey: form.get("requestKey"),
    isActive:
      input.status === "active"
        ? true
        : input.status === "inactive"
          ? false
          : null,
  };
  let updated;
  try {
    updated = id
      ? await updateCustomer(database, actor, context, {
          ...payload,
          id,
          updatedAt: form.get("updatedAt"),
        })
      : await createCustomer(database, actor, context, payload);
  } catch (error) {
    if (error instanceof PermissionDenied) throw error;
    if (error instanceof CustomerError)
      return { error: error.code, fields: error.fields, values };
    if (error instanceof PeriodLockedError)
      return { error: "locked", fields: ["openingDate"], values };
    if (error instanceof IdempotencyConflictError)
      return { error: "conflict", values };
    return { error: "save", values };
  }

  revalidatePath("/customers");
  redirect(`/customers/${updated.id}?saved=1`);
}

export async function createCustomerAction(
  _: CustomerFormState,
  form: FormData,
) {
  return submitCustomer(form);
}

export async function updateCustomerAction(
  id: string,
  _: CustomerFormState,
  form: FormData,
) {
  return submitCustomer(form, id);
}
