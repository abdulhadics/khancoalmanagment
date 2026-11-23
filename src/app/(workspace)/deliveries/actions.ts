"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { PermissionDenied } from "@/domain/permissions";
import {
  createDeliveryRecord,
  recordDeliveryPickup,
  completeDeliveryRecord,
  DeliveryCommandError,
  type DeliveryErrorCode,
} from "@/server/deliveries/mutations";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { PeriodLockedError } from "@/server/repositories/periods";

export type DeliveryActionState = {
  success?: boolean;
  error?: DeliveryErrorCode | "unknown";
  field?: string;
};

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

export async function createDeliveryAction(
  _: DeliveryActionState,
  form: FormData,
): Promise<DeliveryActionState> {
  await assertActionOrigin();
  const actor = await requireActor();

  try {
    const db = getDatabase();
    const context = await getRequestContext();

    await createDeliveryRecord(db, actor, context, {
      key: text(form, "key") || randomUUID(),
      customerId: text(form, "customerId"),
      businessDate: text(form, "businessDate"),
      orderedWeight: text(form, "orderedWeight"),
      notes: text(form, "notes"),
    });

    revalidatePath("/deliveries");
    return { success: true };
  } catch (err) {
    if (err instanceof DeliveryCommandError) {
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

export async function recordPickupAction(
  _: DeliveryActionState,
  form: FormData,
): Promise<DeliveryActionState> {
  await assertActionOrigin();
  const actor = await requireActor();

  try {
    const db = getDatabase();
    const context = await getRequestContext();

    await recordDeliveryPickup(db, actor, context, {
      key: text(form, "key") || randomUUID(),
      deliveryRecordId: text(form, "deliveryRecordId"),
      businessDate: text(form, "businessDate"),
      weight: text(form, "weight"),
      vehicleNo: text(form, "vehicleNo"),
      notes: text(form, "notes"),
    });

    revalidatePath("/deliveries");
    return { success: true };
  } catch (err) {
    if (err instanceof DeliveryCommandError) {
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

export async function completeDeliveryAction(
  _: DeliveryActionState,
  form: FormData,
): Promise<DeliveryActionState> {
  await assertActionOrigin();
  const actor = await requireActor();

  try {
    const db = getDatabase();
    const context = await getRequestContext();

    await completeDeliveryRecord(db, actor, context, {
      key: text(form, "key") || randomUUID(),
      deliveryRecordId: text(form, "deliveryRecordId"),
      notes: text(form, "notes"),
    });

    revalidatePath("/deliveries");
    return { success: true };
  } catch (err) {
    if (err instanceof DeliveryCommandError) {
      return { error: err.code, field: err.field };
    }
    if (err instanceof PermissionDenied) {
      return { error: "denied" };
    }
    return { error: "save" };
  }
}
