"use server";

import { revalidatePath } from "next/cache";
import { PermissionDenied } from "@/domain/permissions";
import { administration } from "@/i18n/messages/admin-en";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  changeAccountingPeriod,
  PeriodChangeError,
} from "@/server/admin/periods";

export type PeriodActionState =
  | { status: "error"; message: string; fields?: readonly string[] }
  | { status: "success"; message: string }
  | null;

export async function savePeriodLock(
  _previous: PeriodActionState,
  form: FormData,
): Promise<PeriodActionState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const t = administration.period;
  try {
    const result = await changeAccountingPeriod(
      getDatabase(),
      actor,
      await getRequestContext(),
      {
        year: form.get("year"),
        month: form.get("month"),
        operation: form.get("operation"),
        reason: form.get("reason"),
      },
    );
    revalidatePath("/admin/periods");
    return {
      status: "success",
      message: result.changed
        ? t.saved(result.scope, result.locked)
        : t.unchanged,
    };
  } catch (error) {
    if (error instanceof PeriodChangeError) {
      return { status: "error", message: t.invalid, fields: error.fields };
    }
    if (error instanceof PermissionDenied) {
      return { status: "error", message: t.denied };
    }
    throw error;
  }
}
