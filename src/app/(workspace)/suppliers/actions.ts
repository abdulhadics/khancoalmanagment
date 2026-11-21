"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PermissionDenied } from "@/domain/permissions";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { SupplierError, mutateSupplier } from "@/server/parties/suppliers";
import { IdempotencyConflictError } from "@/server/repositories/idempotency";
import { PeriodLockedError } from "@/server/repositories/periods";

export type SupplierFormState = {
  error?: SupplierError["code"] | "closed" | "denied" | "save";
  fields?: readonly string[];
  values?: Readonly<Record<string, string>>;
};

export type SupplierAction = (
  previous: SupplierFormState,
  form: FormData,
) => Promise<SupplierFormState>;

function readValues(form: FormData, names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => {
      const value = form.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

const supplierInputs = [
  "name",
  "contactPerson",
  "email",
  "phone",
  "city",
  "region",
  "address",
  "notes",
] as const;
const mineInputs = ["code", "name", "active", "default"] as const;

async function save(
  input: Record<string, unknown>,
  values: Readonly<Record<string, string>>,
) {
  await assertActionOrigin();
  const actor = await requireActor();
  const request = await getRequestContext();
  let supplierId: string;
  try {
    supplierId = (await mutateSupplier(getDatabase(), actor, request, input))
      .supplierId;
  } catch (error) {
    if (error instanceof SupplierError)
      return { error: error.code, fields: error.fields, values };
    if (error instanceof PeriodLockedError)
      return { error: "closed", fields: ["date"], values } as const;
    if (error instanceof PermissionDenied)
      return { error: "denied", values } as const;
    if (error instanceof IdempotencyConflictError)
      return { error: "changed", values } as const;
    return { error: "save", values } as const;
  }
  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${supplierId}`);
  redirect(`/suppliers/${supplierId}?saved=1`);
}

export async function createSupplierAction(
  _: SupplierFormState,
  form: FormData,
): Promise<SupplierFormState> {
  const fields = readValues(form, supplierInputs);
  const values = {
    ...fields,
    ...readValues(form, [
      "active",
      "openingAmount",
      "date",
      "mineCode",
      "mineName",
    ]),
  };
  return save(
    {
      operation: "create",
      key: form.get("key"),
      fields: { ...fields, isActive: values.active === "on" },
      opening: values.openingAmount
        ? { amount: values.openingAmount, date: values.date }
        : undefined,
      defaultMine:
        values.mineCode || values.mineName
          ? { code: values.mineCode, name: values.mineName || values.mineCode }
          : undefined,
    },
    values,
  );
}

export async function editSupplierAction(
  supplierId: string,
  version: string,
  _: SupplierFormState,
  form: FormData,
): Promise<SupplierFormState> {
  const fields = readValues(form, supplierInputs);
  const active = form.get("active") === "on";
  return save(
    {
      operation: "edit",
      key: form.get("key"),
      supplierId,
      version,
      fields: { ...fields, isActive: active },
    },
    { ...fields, active: active ? "on" : "" },
  );
}

export async function addMineAction(
  supplierId: string,
  _: SupplierFormState,
  form: FormData,
): Promise<SupplierFormState> {
  const values = readValues(form, mineInputs);
  return save(
    {
      operation: "addMine",
      key: form.get("key"),
      supplierId,
      fields: {
        code: values.code,
        name: values.name,
        isActive: values.active === "on",
        isDefault: values.default === "on",
      },
    },
    values,
  );
}

export async function editMineAction(
  supplierId: string,
  mineId: string,
  version: string,
  _: SupplierFormState,
  form: FormData,
): Promise<SupplierFormState> {
  const values = readValues(form, mineInputs);
  return save(
    {
      operation: "editMine",
      key: form.get("key"),
      supplierId,
      mineId,
      version,
      fields: {
        code: values.code,
        name: values.name,
        isActive: values.active === "on",
        isDefault: values.default === "on",
      },
    },
    values,
  );
}

export async function adjustOpeningAction(
  supplierId: string,
  _: SupplierFormState,
  form: FormData,
): Promise<SupplierFormState> {
  const values = readValues(form, ["amount", "date", "reason"]);
  return save(
    {
      operation: "openingCorrection",
      key: form.get("key"),
      supplierId,
      opening: { amount: values.amount, date: values.date },
      reason: values.reason,
    },
    values,
  );
}
