import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { todayBusinessDate } from "@/domain/business-date";
import { can, canAccessOrder } from "@/domain/permissions";
import { orders as t } from "@/i18n/messages/orders-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  readDispatchOptions,
  readOrderForWorkspace,
} from "@/server/orders/workspace";
import type { EditMode } from "../../form-state";
import { OrderEditForm } from "./order-edit-form";
import { EditDispatchDialog } from "./edit-dialog";

export const metadata = { title: t.editHeading };

export default async function EditOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ void?: string }>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "orders.view")) notFound();
  const { id } = await params;
  const { void: voidRequest } = await searchParams;
  const db = getDatabase();
  const order = await readOrderForWorkspace(db, actor, id);
  if (!order) notFound();
  const today = todayBusinessDate();
  let mode: EditMode;
  if (voidRequest === "1") {
    if (!canAccessOrder(actor, "orders.void", order, today)) notFound();
    mode = "void";
  } else if (canAccessOrder(actor, "orders.post", order, today)) {
    mode = order.status === "POSTED" ? "correct" : "price";
  } else if (canAccessOrder(actor, "orders.editPending", order, today)) {
    mode = "pending";
  } else if (canAccessOrder(actor, "orders.editMetadata", order, today)) {
    mode = "metadata";
  } else {
    notFound();
  }
  const options =
    mode === "void" || mode === "metadata"
      ? { customers: [], suppliers: [] }
      : await readDispatchOptions(db, actor);

  return (
    <EditDispatchDialog back={`/orders?date=${order.businessDate}`}>
      <header className="page-heading">
        <h1 id="edit-dispatch-title">
          {mode === "void"
            ? t.void
            : mode === "price"
              ? t.pricingHeading
              : t.editHeading}
        </h1>
        <p>
          {order.orderNo} · {t.statuses[order.status]}
        </p>
      </header>
      <OrderEditForm
        order={order}
        mode={mode}
        requestKey={randomUUID()}
        lockedDate={actor.roleCode === "OPERATOR"}
        options={options}
      />
    </EditDispatchDialog>
  );
}
