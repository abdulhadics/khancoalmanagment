"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db/client";
import {
  assertActionOrigin,
  getRequestContext,
} from "@/server/auth/request-context";
import {
  StaffError,
  mutateStaff,
  type StaffErrorCode,
} from "@/server/auth/staff";
import { requireStaffManager } from "./access";

export type StaffFormState = {
  error?: StaffErrorCode | "save";
  fields?: readonly string[];
  values?: Readonly<Record<string, string>>;
};

async function saveStaff(
  command: Record<string, unknown>,
  values: Readonly<Record<string, string>>,
): Promise<StaffFormState> {
  await assertActionOrigin();
  const actor = await requireStaffManager();
  const request = await getRequestContext();

  let result;
  try {
    result = await mutateStaff(getDatabase(), actor, request, command);
  } catch (error) {
    if (error instanceof StaffError) {
      return { error: error.code, fields: error.fields, values };
    }
    return { error: "save", values };
  }

  revalidatePath("/settings/users");
  if (result.reauthenticate) redirect("/login");
  redirect(`/settings/users/${result.staffId}?saved=${command.operation}`);
}

function readText(form: FormData, name: string): string {
  const field = form.get(name);
  return typeof field === "string" ? field : "";
}

export async function createStaffAction(_: StaffFormState, form: FormData) {
  const values = {
    displayName: readText(form, "displayName").slice(0, 120),
    username: readText(form, "username").slice(0, 64),
    email: readText(form, "email").slice(0, 254),
    roleCode: readText(form, "roleCode").slice(0, 16),
  };
  return saveStaff(
    {
      operation: "create",
      displayName: form.get("displayName"),
      username: form.get("username"),
      email: form.get("email"),
      roleCode: form.get("roleCode"),
      password: form.get("password"),
    },
    values,
  );
}

export async function updateStaffAccessAction(
  id: string,
  _: StaffFormState,
  form: FormData,
) {
  const status = readText(form, "status");
  const roleCode = readText(form, "roleCode").slice(0, 16);
  return saveStaff(
    {
      operation: "access",
      userId: id,
      roleCode: form.get("roleCode"),
      isActive:
        status === "active" ? true : status === "disabled" ? false : undefined,
    },
    { roleCode, status: status.slice(0, 16) },
  );
}

export async function resetStaffPasswordAction(
  id: string,
  _: StaffFormState,
  form: FormData,
) {
  return saveStaff(
    { operation: "reset", userId: id, password: form.get("password") },
    {},
  );
}
