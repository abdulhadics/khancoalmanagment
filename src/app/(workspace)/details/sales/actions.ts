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
import { OrderMutationError, voidOrders } from "@/server/orders/mutations";
import { PeriodLockedError } from "@/server/repositories/periods";

export type SalesVoidState = {
  error?: "denied" | "invalid" | "stale" | "closed" | "save";
};

export async function voidSalesOrders(
  filters: string,
  _: SalesVoidState,
  form: FormData,
): Promise<SalesVoidState> {
  await assertActionOrigin();
  const actor = await requireActor();
  const orders = form.getAll("order").map((entry) => {
    const [orderId, revision] =
      typeof entry === "string" ? entry.split(":") : [];
    return { orderId, revisionNo: Number(revision) };
  });
  let count: number;
  try {
    const result = await voidOrders(
      getDatabase(),
      actor,
      await getRequestContext(),
      {
        key: form.get("key"),
        reason: form.get("reason"),
        orders,
      },
    );
    count = result.ids.length;
  } catch (error) {
    if (error instanceof PermissionDenied) return { error: "denied" };
    if (error instanceof PeriodLockedError) return { error: "closed" };
    if (error instanceof OrderMutationError) {
      if (error.code === "missing" || error.code === "stale")
        return { error: "stale" };
      if (error.code === "invalid") return { error: "invalid" };
    }
    return { error: "save" };
  }
  for (const path of ["/details/sales", "/orders", "/"]) revalidatePath(path);
  const params = new URLSearchParams(filters);
  params.set("voided", String(count));
  redirect(`/details/sales?${params}`);
}
