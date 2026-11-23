import { Decimal } from "decimal.js";
import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { requirePermission } from "@/domain/permissions";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  fingerprintCommand,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { lockOpenBusinessMonths, PeriodLockedError } from "../repositories/periods";

export type DeliveryErrorCode =
  | "invalid"
  | "required"
  | "closed"
  | "missing"
  | "excessWeight"
  | "alreadyCompleted"
  | "denied"
  | "save";

export class DeliveryCommandError extends Error {
  constructor(
    public readonly code: DeliveryErrorCode,
    public readonly field?: string,
  ) {
    super(code);
    this.name = "DeliveryCommandError";
  }
}

const keySchema = z.uuid();
const businessDateSchema = z.string().length(10);
const weightSchema = z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Invalid weight");

const createDeliveryInput = z.strictObject({
  key: keySchema,
  customerId: z.uuid(),
  businessDate: businessDateSchema,
  orderedWeight: weightSchema,
  notes: z
    .string()
    .trim()
    .max(1500)
    .nullish()
    .transform((value) => value || null),
});

const recordPickupInput = z.strictObject({
  key: keySchema,
  deliveryRecordId: z.uuid(),
  businessDate: businessDateSchema,
  weight: weightSchema,
  vehicleNo: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((value) => value || null),
  notes: z
    .string()
    .trim()
    .max(1500)
    .nullish()
    .transform((value) => value || null),
});

const completeDeliveryInput = z.strictObject({
  key: keySchema,
  deliveryRecordId: z.uuid(),
  notes: z
    .string()
    .trim()
    .max(1500)
    .nullish()
    .transform((value) => value || null),
});

type RequestContext = { requestId: string; ipAddress?: string };

function validBusinessDate(value: string, now: Date) {
  try {
    if (value <= todayBusinessDate(now)) return parseBusinessDate(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw new DeliveryCommandError("invalid", "businessDate");
}

export async function createDeliveryRecord(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "deliveries.manage");
  const parsed = createDeliveryInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DeliveryCommandError(
      issue?.code === "too_small" ? "required" : "invalid",
      String(issue?.path[0] ?? ""),
    );
  }
  const input = parsed.data;
  const date = validBusinessDate(input.businessDate, now);
  const orderedWeight = new Decimal(input.orderedWeight);
  if (orderedWeight.lte(0)) {
    throw new DeliveryCommandError("invalid", "orderedWeight");
  }

  try {
    const result = await runIdempotentCommand(
      database,
      {
        actorId: actor.userId,
        key: input.key,
        operation: "delivery.create",
        requestDigest: fingerprintCommand(input),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => {
        await lockOpenBusinessMonths(tx, [date]);
        const customer = await tx.customer.findUnique({
          where: { id: input.customerId },
          select: { id: true, isActive: true },
        });
        if (!customer || !customer.isActive) {
          throw new DeliveryCommandError("missing", "customerId");
        }

        const delivery = await tx.deliveryRecord.create({
          data: {
            customerId: input.customerId,
            businessDate: date,
            orderedWeight: orderedWeight.toFixed(3),
            deliveredWeight: "0.000",
            notes: input.notes,
            createdById: actor.userId,
          },
          select: { id: true },
        });

        await appendAuditEvent(tx, {
          ...context,
          actor: { type: "USER", id: actor.userId },
          area: "deliveries",
          action: "delivery.create",
          targetType: "deliveryRecord",
          targetId: delivery.id,
          outcome: "SUCCESS",
          after: {
            customerId: input.customerId,
            businessDate: input.businessDate,
            orderedWeight: orderedWeight.toFixed(3),
          },
        });

        return { resourceIds: [delivery.id] };
      },
      (tx) => requireLivePermission(tx, actor, "deliveries.manage", now),
    );

    return { id: result.resourceIds[0] };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      throw new DeliveryCommandError("closed", "businessDate");
    }
    throw error;
  }
}

export async function recordDeliveryPickup(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "deliveries.manage");
  const parsed = recordPickupInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DeliveryCommandError(
      issue?.code === "too_small" ? "required" : "invalid",
      String(issue?.path[0] ?? ""),
    );
  }
  const input = parsed.data;
  const date = validBusinessDate(input.businessDate, now);
  const pickupWeight = new Decimal(input.weight);
  if (pickupWeight.lte(0)) {
    throw new DeliveryCommandError("invalid", "weight");
  }

  try {
    const result = await runIdempotentCommand(
      database,
      {
        actorId: actor.userId,
        key: input.key,
        operation: "delivery.pickup",
        requestDigest: fingerprintCommand(input),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => {
        await lockOpenBusinessMonths(tx, [date]);
        const record = await tx.deliveryRecord.findUnique({
          where: { id: input.deliveryRecordId },
          select: {
            id: true,
            orderedWeight: true,
            deliveredWeight: true,
            isComplete: true,
          },
        });
        if (!record) throw new DeliveryCommandError("missing", "deliveryRecordId");
        if (record.isComplete) {
          throw new DeliveryCommandError("alreadyCompleted", "deliveryRecordId");
        }

        const newDelivered = new Decimal(record.deliveredWeight).plus(pickupWeight);
        const ordered = new Decimal(record.orderedWeight);
        if (newDelivered.gt(ordered)) {
          throw new DeliveryCommandError("excessWeight", "weight");
        }

        const isComplete = newDelivered.gte(ordered);

        const pickup = await tx.deliveryPickup.create({
          data: {
            deliveryRecordId: input.deliveryRecordId,
            businessDate: date,
            weight: pickupWeight.toFixed(3),
            vehicleNo: input.vehicleNo,
            notes: input.notes,
            createdById: actor.userId,
          },
          select: { id: true },
        });

        await tx.deliveryRecord.update({
          where: { id: input.deliveryRecordId },
          data: {
            deliveredWeight: newDelivered.toFixed(3),
            isComplete,
          },
        });

        await appendAuditEvent(tx, {
          ...context,
          actor: { type: "USER", id: actor.userId },
          area: "deliveries",
          action: "delivery.pickup",
          targetType: "deliveryPickup",
          targetId: pickup.id,
          outcome: "SUCCESS",
          after: {
            deliveryRecordId: input.deliveryRecordId,
            weight: pickupWeight.toFixed(3),
            vehicleNo: input.vehicleNo,
            totalDelivered: newDelivered.toFixed(3),
            isComplete,
          },
        });

        return { resourceIds: [pickup.id] };
      },
      (tx) => requireLivePermission(tx, actor, "deliveries.manage", now),
    );

    return { id: result.resourceIds[0] };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      throw new DeliveryCommandError("closed", "businessDate");
    }
    throw error;
  }
}

export async function completeDeliveryRecord(
  database: PrismaClient,
  actor: LivePrincipal,
  context: RequestContext,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "deliveries.manage");
  const parsed = completeDeliveryInput.safeParse(raw);
  if (!parsed.success) {
    throw new DeliveryCommandError("invalid", String(parsed.error.issues[0]?.path[0] ?? ""));
  }
  const input = parsed.data;

  const result = await runIdempotentCommand(
    database,
    {
      actorId: actor.userId,
      key: input.key,
      operation: "delivery.complete",
      requestDigest: fingerprintCommand(input),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    },
    async (tx) => {
      const record = await tx.deliveryRecord.findUnique({
        where: { id: input.deliveryRecordId },
        select: { id: true, isComplete: true, orderedWeight: true },
      });
      if (!record) throw new DeliveryCommandError("missing", "deliveryRecordId");
      if (record.isComplete) {
        throw new DeliveryCommandError("alreadyCompleted", "deliveryRecordId");
      }

      await tx.deliveryRecord.update({
        where: { id: input.deliveryRecordId },
        data: {
          isComplete: true,
          deliveredWeight: record.orderedWeight,
          notes: input.notes,
        },
      });

      await appendAuditEvent(tx, {
        ...context,
        actor: { type: "USER", id: actor.userId },
        area: "deliveries",
        action: "delivery.complete",
        targetType: "deliveryRecord",
        targetId: input.deliveryRecordId,
        outcome: "SUCCESS",
        after: { isComplete: true },
      });

      return { resourceIds: [input.deliveryRecordId] };
    },
    (tx) => requireLivePermission(tx, actor, "deliveries.manage", now),
  );

  return { id: result.resourceIds[0] };
}
