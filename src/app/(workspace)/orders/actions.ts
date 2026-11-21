"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PermissionDenied, requirePermission } from "@/domain/permissions";
import { orders, type OrderErrorCode } from "@/i18n/messages/orders-en";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { createCustomer } from "@/server/customers";
import { getDatabase } from "@/server/db/client";
import { createOrders, OrderCreateError } from "@/server/orders/create";
import {
  correctOrder,
  editOrderMetadata,
  editPendingOrder,
  OrderMutationError,
  priceOrder,
  voidOrder,
} from "@/server/orders/mutations";
import { mutateSupplier } from "@/server/parties/suppliers";
import { IdempotencyConflictError } from "@/server/repositories/idempotency";
import { PeriodLockedError } from "@/server/repositories/periods";
import type { BatchState, EditMode, EditState, OrderIssue } from "./form-state";

const batchPayload = z.object({
  key: z.uuid(),
  businessDate: z.string().max(10),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
});

function text(form: FormData, key: string) {
  const field = form.get(key);
  return typeof field === "string" ? field : "";
}

function knownCode(code: string): OrderErrorCode {
  return Object.hasOwn(orders.errors, code) ? (code as OrderErrorCode) : "save";
}

function commonIssue(error: unknown): OrderIssue {
  if (error instanceof PermissionDenied) return { code: "denied" };
  if (error instanceof PeriodLockedError) return { code: "closed" };
  if (error instanceof IdempotencyConflictError) return { code: "conflict" };
  return { code: "save" };
}

export async function submitOrderBatch(
  _: BatchState,
  form: FormData,
): Promise<BatchState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const payload = text(form, "batch");
  let input: z.infer<typeof batchPayload>;
  try {
    if (payload.length > 260_000) return { issues: [{ code: "invalid" }] };
    input = batchPayload.parse(JSON.parse(payload));
  } catch {
    return { issues: [{ code: "invalid" }] };
  }

  let count: number;
  try {
    const result = await createOrders(
      getDatabase(),
      actor,
      await getRequestContext(),
      input,
    );
    count = result.orderIds.length;
  } catch (error) {
    if (error instanceof OrderCreateError) {
      return {
        issues: error.issues.map(({ row, field, code }) => ({
          row,
          field,
          code: knownCode(code),
        })),
      };
    }
    return { issues: [commonIssue(error)] };
  }

  revalidatePath("/orders");
  return {
    saved: { count, key: randomUUID(), businessDate: input.businessDate },
  };
}

const editActions = {
  pending: editPendingOrder,
  metadata: editOrderMetadata,
  price: priceOrder,
  correct: correctOrder,
  void: voidOrder,
};

export async function submitOrderEdit(
  orderId: string,
  mode: EditMode,
  _: EditState,
  form: FormData,
): Promise<EditState> {
  await assertActionOrigin();
  const actor = await requireActor();
  if (!Object.hasOwn(editActions, mode)) return { issue: { code: "invalid" } };
  const common = {
    orderId,
    revisionNo: Number(text(form, "revisionNo")),
    key: text(form, "key"),
  };
  const metadata = {
    vehicleNo: text(form, "vehicleNo"),
    biltyNo: text(form, "biltyNo"),
    notes: text(form, "notes"),
    confirmDuplicateVehicle: form.has("confirmDuplicateVehicle"),
  };
  const full = {
    ...metadata,
    businessDate: text(form, "businessDate"),
    customerId: text(form, "customerId"),
    supplierId: text(form, "supplierId"),
    mineId: text(form, "mineId"),
    weight: text(form, "weight"),
    sellRate: text(form, "sellRate"),
    confirmCreditLimit: form.has("confirmCreditLimit"),
  };
  const fields = {
    pending: full,
    metadata,
    price: { ...full, purchaseRate: text(form, "purchaseRate") },
    correct: {
      ...full,
      purchaseRate: text(form, "purchaseRate"),
      reason: text(form, "reason") || undefined,
    },
    void: { reason: text(form, "reason") },
  }[mode];
  try {
    await editActions[mode](getDatabase(), actor, await getRequestContext(), {
      ...common,
      ...fields,
    });
  } catch (error) {
    if (error instanceof OrderMutationError) {
      return { issue: { code: knownCode(error.code), field: error.field } };
    }
    return { issue: commonIssue(error) };
  }

  revalidatePath("/orders");
  const date = text(form, "returnDate");
  redirect(`/orders?date=${encodeURIComponent(date)}&updated=1`);
}

export async function quickAddDispatchParty(
  kind: "customer" | "supplier",
  form: FormData,
) {
  await assertActionOrigin();
  const actor = await requireActor();
  requirePermission(actor, "parties.manage");
  const db = getDatabase();
  const context = await getRequestContext();
  const key = text(form, "key");
  const name = text(form, "name");
  try {
    if (kind === "customer") {
      const { id } = await createCustomer(db, actor, context, {
        requestKey: key,
        name,
      });
      const customer = await db.customer.findUniqueOrThrow({
        where: { id },
        select: { id: true, name: true, code: true },
      });
      revalidatePath("/customers");
      return { customer };
    }
    if (kind === "supplier") {
      const { supplierId } = await mutateSupplier(db, actor, context, {
        operation: "create",
        key,
        fields: { name },
        defaultMine: {
          code: text(form, "mineNumber"),
          name: text(form, "mineName"),
          isDefault: true,
        },
      });
      const supplier = await db.supplier.findUniqueOrThrow({
        where: { id: supplierId },
        select: {
          id: true,
          name: true,
          code: true,
          mines: {
            where: { isActive: true },
            select: { id: true, code: true, name: true, isDefault: true },
          },
        },
      });
      revalidatePath("/suppliers");
      return { supplier };
    }
  } catch {
    return { error: orders.errors.party };
  }
  return { error: orders.errors.party };
}
