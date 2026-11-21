import { Decimal } from "decimal.js";
import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import {
  canAccessOrder,
  PermissionDenied,
  requirePermission,
  type Permission,
} from "@/domain/permissions";
import {
  Prisma,
  type OrderStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  fingerprintCommand,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { getPartyRollups } from "../repositories/party-ledger-rollups";
import { lockOpenBusinessMonths } from "../repositories/periods";
import {
  dispatchRowSchema,
  DispatchInputError,
  duplicateVehicleKey,
  normalizeBiltyNo,
  normalizeVehicleNo,
  prepareDispatchRow,
  type PreparedDispatchRow,
} from "./dispatch-input";
import {
  findVehicleDuplicates,
  lockDispatchParties,
  resolveDispatchMine,
} from "./dispatch-parties";
import { OrderMutationError } from "./order-mutation-error";
import { appendOrderPostings } from "./postings";
import { readLiveOrderPostings, reverseOrderPostings } from "./reversals";

export { OrderMutationError } from "./order-mutation-error";

type RequestContext = { requestId: string; ipAddress?: string };

const versionSchema = z.object({
  orderId: z.uuid().transform((id) => id.toLowerCase()),
  revisionNo: z.number().int().positive().max(2_147_483_647),
});
const keySchema = z.uuid();
const reasonSchema = z.string().trim().min(1).max(500);
const targetSchema = versionSchema.extend({ key: keySchema });

const fullEditSchema = dispatchRowSchema.extend({
  ...targetSchema.shape,
  businessDate: z.string().length(10),
  reason: z.string().trim().max(500).nullish(),
});

const metadataSchema = z.strictObject({
  ...targetSchema.shape,
  vehicleNo: dispatchRowSchema.shape.vehicleNo,
  biltyNo: dispatchRowSchema.shape.biltyNo,
  notes: dispatchRowSchema.shape.notes,
  confirmDuplicateVehicle: dispatchRowSchema.shape.confirmDuplicateVehicle,
});

const voidSchema = z.strictObject({
  ...targetSchema.shape,
  reason: reasonSchema,
});
const bulkVoidSchema = z.strictObject({
  key: keySchema,
  reason: reasonSchema,
  orders: z.array(versionSchema).min(1).max(100),
});

type Target = z.output<typeof versionSchema>;
type OrderRecord = Prisma.OrderGetPayload<{
  include: { currentRevision: true };
}>;
type CurrentOrder = OrderRecord & {
  currentRevision: NonNullable<OrderRecord["currentRevision"]>;
};
type ChangedColumns = Pick<
  PreparedDispatchRow,
  "vehicleNo" | "biltyNo" | "notes"
>;
type FullRevision = Omit<
  PreparedDispatchRow,
  "confirmDuplicateVehicle" | "confirmCreditLimit" | "mineId"
> & { mineId: string };

function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new OrderMutationError(
    "invalid",
    result.error.issues[0]?.path.map(String).join("."),
  );
}

function businessDate(input: string, today: string) {
  try {
    const date = parseBusinessDate(input);
    if (input > today) throw new RangeError();
    return date;
  } catch {
    throw new OrderMutationError("invalid", "businessDate");
  }
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currentVersion(
  order: OrderRecord | null,
  target: Target,
  actor: LivePrincipal,
  today: string,
): CurrentOrder {
  if (!order) throw new OrderMutationError("missing");
  if (
    !canAccessOrder(
      actor,
      "orders.view",
      { ...order, businessDate: iso(order.businessDate) },
      today,
    )
  ) {
    throw new PermissionDenied();
  }
  if (
    order.status === "VOIDED" ||
    order.currentRevisionNo !== target.revisionNo
  )
    throw new OrderMutationError("stale");
  if (!order.currentRevision) throw new OrderMutationError("integrity");
  return { ...order, currentRevision: order.currentRevision };
}

function loadOrder(tx: Prisma.TransactionClient, id: string) {
  return tx.order.findUnique({
    where: { id },
    include: { currentRevision: true },
  });
}

async function lockVersion(
  tx: Prisma.TransactionClient,
  target: Target,
  actor: LivePrincipal,
  today: string,
  newDate?: Date,
) {
  const before = currentVersion(
    await loadOrder(tx, target.orderId),
    target,
    actor,
    today,
  );
  await lockOpenBusinessMonths(
    tx,
    newDate ? [before.businessDate, newDate] : [before.businessDate],
  );
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${target.orderId}::uuid FOR UPDATE`;
  return currentVersion(
    await loadOrder(tx, target.orderId),
    target,
    actor,
    today,
  );
}

async function checkDuplicateFields(
  tx: Prisma.TransactionClient,
  order: CurrentOrder,
  next: {
    businessDate: Date;
    supplierId: string;
    vehicleNo: string;
    biltyNo: string | null;
  },
  confirmDuplicateVehicle: boolean,
) {
  const sameDate = next.businessDate.getTime() === order.businessDate.getTime();
  if (
    next.biltyNo &&
    (!sameDate ||
      next.supplierId !== order.supplierId ||
      next.biltyNo !== order.biltyNo)
  ) {
    const existing = await tx.order.findFirst({
      where: {
        id: { not: order.id },
        status: { not: "VOIDED" },
        supplierId: next.supplierId,
        businessDate: next.businessDate,
        biltyNo: next.biltyNo,
      },
      select: { id: true },
    });
    if (existing) throw new OrderMutationError("duplicateBilty", "biltyNo");
  }

  const vehicleKey = duplicateVehicleKey(next.vehicleNo);
  if (
    !confirmDuplicateVehicle &&
    (!sameDate || duplicateVehicleKey(order.vehicleNo) !== vehicleKey)
  ) {
    const duplicates = await findVehicleDuplicates(
      tx,
      next.businessDate,
      [next.vehicleNo],
      order.id,
    );
    if (duplicates.has(vehicleKey))
      throw new OrderMutationError("duplicateVehicle", "vehicleNo");
  }
}

function snapshot(order: CurrentOrder) {
  const revision = order.currentRevision;
  return {
    orderNo: order.orderNo,
    revisionNo: revision.revisionNo,
    status: order.status,
    businessDate: iso(order.businessDate),
    customerId: order.customerId,
    supplierId: order.supplierId,
    mineId: order.mineId,
    vehicleNo: order.vehicleNo,
    biltyNo: order.biltyNo,
    weight: revision.weight.toFixed(3),
    sellRate: revision.sellRate?.toFixed(2) ?? null,
    purchaseRate: revision.purchaseRate?.toFixed(2) ?? null,
    buyAmount: revision.buyAmount?.toFixed(2) ?? null,
    sellAmount: revision.sellAmount?.toFixed(2) ?? null,
    profit: revision.profit?.toFixed(2) ?? null,
  };
}

async function auditMutation(
  tx: Prisma.TransactionClient,
  actor: LivePrincipal,
  context: RequestContext,
  action: string,
  before: CurrentOrder,
  after: CurrentOrder,
  reason?: string,
) {
  await appendAuditEvent(tx, {
    actor: { type: "USER", id: actor.userId },
    area: "orders",
    action,
    targetType: "order",
    targetId: before.id,
    outcome: "SUCCESS",
    ...context,
    before: snapshot(before),
    after: { ...snapshot(after), ...(reason ? { reason } : {}) },
  });
}

function fromCurrentRevision(
  order: CurrentOrder,
  changed: ChangedColumns,
): FullRevision {
  const before = snapshot(order);
  if (before.sellRate === null) throw new OrderMutationError("integrity");
  const { vehicleNo, biltyNo, notes } = changed;
  return {
    customerId: before.customerId,
    supplierId: before.supplierId,
    mineId: before.mineId,
    weight: before.weight,
    sellRate: before.sellRate,
    purchaseRate: before.purchaseRate,
    buyAmount: before.buyAmount,
    sellAmount: before.sellAmount,
    profit: before.profit,
    vehicleNo,
    biltyNo,
    notes,
  };
}

async function saveRevision(
  tx: Prisma.TransactionClient,
  before: CurrentOrder,
  actorId: string,
  date: Date,
  revision: FullRevision,
  profileId: string,
  status: OrderStatus,
): Promise<CurrentOrder> {
  if (before.currentRevision.revisionNo === 2_147_483_647)
    throw new OrderMutationError("integrity");
  const projection = {
    businessDate: date,
    customerId: revision.customerId,
    supplierId: revision.supplierId,
    mineId: revision.mineId,
    vehicleNo: revision.vehicleNo,
    biltyNo: revision.biltyNo,
  };
  const record = await tx.orderRevision.create({
    data: {
      orderId: before.id,
      revisionNo: before.currentRevision.revisionNo + 1,
      ...revision,
      businessDate: date,
      documentProfileId: profileId,
      actorId,
    },
  });
  const order = await tx.order.update({
    where: { id: before.id },
    data: {
      ...projection,
      status,
      currentRevisionNo: record.revisionNo,
      updatedById: actorId,
    },
  });
  return { ...order, currentRevision: record };
}

function dispatchErrors<T>(action: () => Promise<T>) {
  return action().catch((error: unknown) => {
    if (error instanceof DispatchInputError) {
      if (error.code === "pricingForbidden") throw new PermissionDenied();
      throw new OrderMutationError("invalid", error.field);
    }
    throw error;
  });
}

function mutate<T extends { resourceIds: string[] }>(
  database: PrismaClient,
  actor: LivePrincipal,
  permission: Permission,
  operation: string,
  key: string,
  payload: Prisma.JsonValue,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  operatorTarget?: string,
) {
  return runIdempotentCommand(
    database,
    {
      actorId: actor.userId,
      operation,
      key,
      requestDigest: fingerprintCommand(payload),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
    execute,
    async (tx) => {
      await requireLivePermission(tx, actor, permission);
      if (actor.roleCode === "OPERATOR" && operatorTarget) {
        const order = await tx.order.findUnique({
          where: { id: operatorTarget },
          select: { businessDate: true, createdById: true, status: true },
        });
        if (
          !order ||
          !canAccessOrder(
            actor,
            "orders.view",
            {
              ...order,
              businessDate: iso(order.businessDate),
            },
            todayBusinessDate(),
          )
        )
          throw new PermissionDenied();
      }
    },
  );
}

export async function editOrderMetadata(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  requirePermission(actor, "orders.editMetadata");
  return dispatchErrors(async () => {
    const {
      key,
      orderId,
      revisionNo,
      confirmDuplicateVehicle,
      vehicleNo,
      biltyNo,
      notes,
    } = parseInput(metadataSchema, raw);
    const changed = {
      vehicleNo: normalizeVehicleNo(vehicleNo),
      biltyNo: normalizeBiltyNo(biltyNo),
      notes: notes || null,
    };
    await mutate(
      database,
      actor,
      "orders.editMetadata",
      "orders.metadata",
      key,
      { orderId, revisionNo, confirmDuplicateVehicle, ...changed },
      async (tx) => {
        const before = await lockVersion(
          tx,
          { orderId, revisionNo },
          actor,
          todayBusinessDate(),
        );
        if (before.status !== "POSTED") throw new OrderMutationError("stale");
        await checkDuplicateFields(
          tx,
          before,
          {
            businessDate: before.businessDate,
            supplierId: before.supplierId,
            ...changed,
          },
          confirmDuplicateVehicle,
        );
        const after = await saveRevision(
          tx,
          before,
          actor.userId,
          before.businessDate,
          fromCurrentRevision(before, changed),
          before.currentRevision.documentProfileId,
          "POSTED",
        );
        await auditMutation(
          tx,
          actor,
          context,
          "order.metadata",
          before,
          after,
        );
        return { resourceIds: [orderId] };
      },
      orderId,
    );
    return { id: orderId };
  });
}

type FullEdit = "pending" | "price" | "correct";

async function editFullOrder(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
  mode: FullEdit,
) {
  const permission = mode === "pending" ? "orders.editPending" : "orders.post";
  requirePermission(actor, permission);
  return dispatchErrors(async () => {
    const {
      key,
      revisionNo,
      orderId,
      businessDate: dateInput,
      reason,
      ...input
    } = parseInput(fullEditSchema, raw);
    const { confirmDuplicateVehicle, confirmCreditLimit, ...row } =
      prepareDispatchRow(input, { priced: mode !== "pending" });
    await mutate(
      database,
      actor,
      permission,
      `orders.${mode}`,
      key,
      {
        orderId,
        revisionNo,
        businessDate: dateInput,
        reason: reason || null,
        confirmDuplicateVehicle,
        confirmCreditLimit,
        ...row,
      },
      async (tx) => {
        const today = todayBusinessDate();
        if (actor.roleCode === "OPERATOR" && dateInput !== today)
          throw new PermissionDenied();
        const date = businessDate(dateInput, today);
        const before = await lockVersion(
          tx,
          { orderId, revisionNo },
          actor,
          today,
          date,
        );
        const expectedStatus =
          mode === "correct" ? "POSTED" : "PENDING_PRICING";
        if (before.status !== expectedStatus)
          throw new OrderMutationError("stale");

        const prior = snapshot(before);
        const unchangedFinancials =
          mode === "correct" &&
          prior.businessDate === dateInput &&
          prior.customerId === row.customerId &&
          prior.supplierId === row.supplierId &&
          prior.mineId === row.mineId &&
          prior.weight === row.weight &&
          prior.sellRate === row.sellRate &&
          prior.purchaseRate === row.purchaseRate;

        await checkDuplicateFields(
          tx,
          before,
          { businessDate: date, ...row },
          confirmDuplicateVehicle,
        );
        if (unchangedFinancials) {
          const after = await saveRevision(
            tx,
            before,
            actor.userId,
            date,
            fromCurrentRevision(before, row),
            before.currentRevision.documentProfileId,
            "POSTED",
          );
          await auditMutation(
            tx,
            actor,
            context,
            "order.metadata",
            before,
            after,
            reason || undefined,
          );
          return { resourceIds: [orderId] };
        }

        const parties = await lockDispatchParties(tx, [before, row]);
        const revision = { ...row, mineId: resolveDispatchMine(parties, row) };
        const previous =
          mode === "correct" ? await readLiveOrderPostings(tx, orderId) : null;
        let profileId = before.currentRevision.documentProfileId;

        if (mode !== "pending") {
          const limit = parties.customers.get(revision.customerId)?.creditLimit;
          if (!confirmCreditLimit && limit && revision.sellAmount !== null) {
            const [rollup] = await getPartyRollups(
              tx,
              "customer",
              [revision.customerId],
              today,
            );
            const balance = new Decimal(rollup?.balance ?? "0");
            const oldSale =
              previous &&
              previous.sale.customerId === revision.customerId &&
              iso(previous.sale.businessDate) <= today
                ? previous.sale.amount.toString()
                : "0";
            const projected = balance.minus(oldSale).plus(revision.sellAmount);
            if (projected.gt(limit.toString()) && projected.gt(balance)) {
              throw new OrderMutationError("creditLimit", "customerId");
            }
          }
          const settings = await tx.companySettings.findUnique({
            where: { id: 1 },
            select: { documentProfileId: true },
          });
          if (!settings) throw new OrderMutationError("integrity");
          profileId = settings.documentProfileId;
        }

        const nextStatus = mode === "pending" ? "PENDING_PRICING" : "POSTED";
        const after = await saveRevision(
          tx,
          before,
          actor.userId,
          date,
          revision,
          profileId,
          nextStatus,
        );
        if (nextStatus === "POSTED") {
          if (revision.buyAmount === null || revision.sellAmount === null)
            throw new OrderMutationError("integrity");
          if (previous)
            await reverseOrderPostings(
              tx,
              previous,
              actor.userId,
              reason || "Financial order correction",
            );
          await appendOrderPostings(tx, {
            revisionId: after.currentRevision.id,
            businessDate: date,
            customerId: revision.customerId,
            supplierId: revision.supplierId,
            actorId: actor.userId,
            buyAmount: revision.buyAmount,
            sellAmount: revision.sellAmount,
          });
        }
        await auditMutation(
          tx,
          actor,
          context,
          `order.${mode}`,
          before,
          after,
          reason || undefined,
        );
        return { resourceIds: [orderId] };
      },
      orderId,
    );
    return { id: orderId };
  });
}

export function editPendingOrder(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  return editFullOrder(database, actor, context, raw, "pending");
}

export function priceOrder(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  return editFullOrder(database, actor, context, raw, "price");
}

export function correctOrder(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  return editFullOrder(database, actor, context, raw, "correct");
}

export async function voidOrders(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  requirePermission(actor, "orders.void");
  const { key, reason, orders } = parseInput(bulkVoidSchema, raw);
  const targets = orders
    .slice()
    .sort((a, b) => a.orderId.localeCompare(b.orderId));
  const ids = targets.map(({ orderId }) => orderId);
  if (new Set(ids).size !== ids.length)
    throw new OrderMutationError("invalid", "orders");

  await mutate(
    database,
    actor,
    "orders.void",
    "orders.void",
    key,
    { reason, orders: targets },
    async (tx) => {
      const today = todayBusinessDate();
      const initial = await tx.order.findMany({
        where: { id: { in: ids } },
        include: { currentRevision: true },
      });
      const initialById = new Map(initial.map((order) => [order.id, order]));
      const before = targets.map((target) =>
        currentVersion(
          initialById.get(target.orderId) ?? null,
          target,
          actor,
          today,
        ),
      );
      await lockOpenBusinessMonths(
        tx,
        before.map(({ businessDate }) => businessDate),
      );
      await tx.$queryRaw`
      SELECT id FROM orders
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE
    `;
      const locked = await tx.order.findMany({
        where: { id: { in: ids } },
        include: { currentRevision: true },
      });
      const byId = new Map(locked.map((order) => [order.id, order]));
      const current = targets.map((target) =>
        currentVersion(byId.get(target.orderId) ?? null, target, actor, today),
      );
      await lockDispatchParties(tx, current);

      for (const order of current) {
        if (order.status === "POSTED") {
          const pair = await readLiveOrderPostings(tx, order.id);
          await reverseOrderPostings(tx, pair, actor.userId, reason);
        }
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: "VOIDED",
            deletedAt: new Date(),
            deletedById: actor.userId,
            deleteReason: reason,
            updatedById: actor.userId,
          },
        });
        await auditMutation(
          tx,
          actor,
          context,
          "order.void",
          order,
          { ...updated, currentRevision: order.currentRevision },
          reason,
        );
      }
      return { resourceIds: ids };
    },
  );
  return { ids };
}

export async function voidOrder(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
) {
  requirePermission(actor, "orders.void");
  const { key, reason, orderId, revisionNo } = parseInput(voidSchema, raw);
  await voidOrders(database, actor, context, {
    key,
    reason,
    orders: [{ orderId, revisionNo }],
  });
  return { id: orderId };
}
