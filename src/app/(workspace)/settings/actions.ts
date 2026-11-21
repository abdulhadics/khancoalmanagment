"use server";

import { revalidatePath } from "next/cache";

import { PermissionDenied } from "@/domain/permissions";
import { settings } from "@/i18n/messages/settings-en";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  mutateBank,
  SettingsError,
  updateCompanySettings,
} from "@/server/settings/company";

export type SettingsActionState =
  | { kind: "error"; message: string; fields?: readonly string[] }
  | { kind: "success"; message: string; version: string }
  | null;

function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function formError(error: unknown): SettingsActionState {
  if (error instanceof SettingsError) {
    return {
      kind: "error",
      message: settings.errors[error.code],
      fields: error.fields,
    };
  }
  if (error instanceof PermissionDenied) {
    return { kind: "error", message: settings.errors.denied };
  }
  throw error;
}

export async function saveCompany(
  _previous: SettingsActionState,
  data: FormData,
): Promise<SettingsActionState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const uploaded = data.get("logoFile");
  const logo =
    uploaded instanceof File && uploaded.size > 0
      ? uploaded
      : field(data, "removeLogo") === "yes"
        ? "remove"
        : "keep";

  try {
    const updated = await updateCompanySettings(
      getDatabase(),
      actor,
      await getRequestContext(),
      {
        version: field(data, "version"),
        name: field(data, "name"),
        tagline: field(data, "tagline"),
        address: field(data, "address"),
        phone: field(data, "phone"),
        email: field(data, "email").trim(),
        currencySymbol: field(data, "currencySymbol"),
        weightUnit: field(data, "weightUnit"),
        dateFormat: field(data, "dateFormat"),
        numberFormat: field(data, "numberFormat"),
        footer: field(data, "footer"),
        orderPrefix: field(data, "orderPrefix"),
        voucherPrefix: field(data, "voucherPrefix"),
        logo,
      },
    );
    revalidatePath("/", "layout");
    return {
      kind: "success",
      message: settings.saved,
      version: updated.updatedAt.toISOString(),
    };
  } catch (error) {
    return formError(error);
  }
}

export async function saveBank(
  _previous: SettingsActionState,
  data: FormData,
): Promise<SettingsActionState> {
  await assertActionOrigin();
  const actor = await requireActor();
  try {
    const active = field(data, "isActive");
    const updated = await mutateBank(
      getDatabase(),
      actor,
      await getRequestContext(),
      {
        operation: field(data, "operation"),
        id: field(data, "id"),
        version: field(data, "version"),
        name: field(data, "name"),
        category: field(data, "category"),
        isActive: active === "yes" ? true : active === "no" ? false : undefined,
      },
    );
    revalidatePath("/settings");
    return {
      kind: "success",
      message: settings.bankSaved,
      version: updated.updatedAt.toISOString(),
    };
  } catch (error) {
    return formError(error);
  }
}
