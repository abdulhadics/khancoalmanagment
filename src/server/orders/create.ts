import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../domain/business-date";
import { can, requirePermission } from "../../domain/permissions";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvents } from "../repositories/audit-log";
import {
  fingerprintCommand,
  IdempotencyConflictError,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { reserveNumberBlock } from "../repositories/number-sequences";
import { getPartyRollups } from "../repositories/party-ledger-rollups";
import {
  lockOpenBusinessMonths,
  PeriodLockedError,
} from "../repositories/periods";
import {
  DispatchInputError,
  dispatchRowSchema,
  duplicateVehicleKey,
  prepareDispatchRow,
  type OrderCreateIssue,
  type PreparedDispatchRow,
} from "./dispatch-input";
import {
  findVehicleDuplicates,
  lockDispatchParties,
  resolveDispatchMine,
} from "./dispatch-parties";
import { orderPostingRows } from "./postings";

export type { OrderCreateIssue } from "./dispatch-input";
export const MAX_ORDER_BATCH = 100;

export class OrderCreateError extends Error {
  constructor(public readonly issues: readonly OrderCreateIssue[]) {
    super("The dispatch batch was not saved.");
    this.name = "OrderCreateError";
  }
}

const createSchema = z.strictObject({
  key: z.uuid(),
  businessDate: z.string().length(10),
  rows: z.array(dispatchRowSchema).min(1).max(MAX_ORDER_BATCH),
});

type DispatchRequest = { requestId: string; ipAddress?: string };
type ResolvedRow = PreparedDispatchRow & { mineId: string };

function fieldOrThrow(error: unknown, row: number, issues: OrderCreateIssue[]) {
  if (!(error instanceof DispatchInputError)) throw error;
  issues.push({ row, field: error.field, code: error.code });
  return [];
}

function parseDispatchDate(value: string, actor: LivePrincipal, today: string) {
  let date;
  try {
    date = parseBusinessDate(value);
  } catch {
    throw new OrderCreateError([{ field: "businessDate", code: "invalid" }]);
  }
  if (actor.roleCode === "OPERATOR" && value !== today) {
    throw new OrderCreateError([{ field: "businessDate", code: "dateScope" }]);
  }
  if (value > today) {
    throw new OrderCreateError([{ field: "businessDate", code: "invalid" }]);
  }
  return date;
}

function biltyKey(supplierId: string, biltyNo: string) {
  return `${supplierId}:${biltyNo}`;
}

async function findDuplicateIssues(
  tx: Prisma.TransactionClient,
  date: Date,
  rows: readonly ResolvedRow[],
) {
  const vehicles = await findVehicleDuplicates(
    tx,
    date,
    rows.map(({ vehicleNo }) => vehicleNo),
  );
  const biltyNumbers = [
    ...new Set(rows.flatMap(({ biltyNo }) => (biltyNo ? [biltyNo] : []))),
  ];
  const previouslyAssigned = biltyNumbers.length
    ? await tx.order.findMany({
        where: {
          businessDate: date,
          deletedAt: null,
          supplierId: {
            in: [...new Set(rows.map(({ supplierId }) => supplierId))],
          },
          biltyNo: { in: biltyNumbers },
        },
        select: { supplierId: true, biltyNo: true },
      })
    : [];
  const bilties = new Set(
    previouslyAssigned.flatMap(({ supplierId, biltyNo }) =>
      biltyNo ? [biltyKey(supplierId, biltyNo)] : [],
    ),
  );
  const issues: OrderCreateIssue[] = [];
  rows.forEach((row, index) => {
    const vehicle = duplicateVehicleKey(row.vehicleNo);
    if (vehicles.has(vehicle) && !row.confirmDuplicateVehicle) {
      issues.push({ row: index, field: "vehicleNo", code: "duplicateVehicle" });
    }
    vehicles.add(vehicle);
    if (row.biltyNo) {
      const key = biltyKey(row.supplierId, row.biltyNo);
      if (bilties.has(key))
        issues.push({ row: index, field: "biltyNo", code: "duplicateBilty" });
      bilties.add(key);
    }
  });
  return issues;
}

async function findCreditLimitIssues(
  tx: Prisma.TransactionClient,
  parties: Awaited<ReturnType<typeof lockDispatchParties>>,
  rows: readonly ResolvedRow[],
  today: string,
) {
  const limitedCustomers = [...parties.customers.values()]
    .filter(({ creditLimit }) => creditLimit !== null)
    .map(({ id }) => id);
  if (limitedCustomers.length === 0) return [];
  const rollups = await getPartyRollups(
    tx,
    "customer",
    limitedCustomers,
    today,
  );
  const balanceById = new Map(
    rollups.map(({ partyId, balance }) => [partyId, new Decimal(balance)]),
  );
  const issues: OrderCreateIssue[] = [];
  rows.forEach((row, index) => {
    const limit = parties.customers.get(row.customerId)?.creditLimit;
    if (limit == null || row.sellAmount === null) return;
    const nextBalance = (
      balanceById.get(row.customerId) ?? new Decimal(0)
    ).plus(row.sellAmount);
    balanceById.set(row.customerId, nextBalance);
    if (nextBalance.gt(limit.toString()) && !row.confirmCreditLimit) {
      issues.push({ row: index, field: "customerId", code: "creditLimit" });
    }
  });
  return issues;
}

export async function createOrders(
  database: PrismaClient,
  actor: LivePrincipal,
  request: DispatchRequest,
  rawCommand: unknown,
  now = new Date(),
) {
  requirePermission(actor, "orders.create");
  const input = createSchema.safeParse(rawCommand);
  if (!input.success) {
    throw new OrderCreateError(
      input.error.issues.map(({ path, code }) => ({
        row: typeof path[1] === "number" ? path[1] : undefined,
        field: String(path[path.length - 1] ?? "rows"),
        code: code === "too_small" ? "required" : "invalid",
      })),
    );
  }

  const { key, businessDate } = input.data;
  const today = todayBusinessDate(now);
  const date = parseDispatchDate(businessDate, actor, today);
  const priced = can(actor.roleCode, "orders.post");
  const rowIssues: OrderCreateIssue[] = [];
  const prepared = input.data.rows.flatMap((row, index) => {
    try {
      return [prepareDispatchRow(row, { priced })];
    } catch (error) {
      return fieldOrThrow(error, index, rowIssues);
    }
  });
  if (rowIssues.length) throw new OrderCreateError(rowIssues);

  try {
    const result = await runIdempotentCommand(
      database,
      {
        key,
        actorId: actor.userId,
        operation: "orders.create",
        requestDigest: fingerprintCommand({ businessDate, rows: prepared }),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => {
        await lockOpenBusinessMonths(tx, [date]);
        const parties = await lockDispatchParties(tx, prepared);
        const rows = prepared.flatMap((row, index) => {
          try {
            return [{ ...row, mineId: resolveDispatchMine(parties, row) }];
          } catch (error) {
            return fieldOrThrow(error, index, rowIssues);
          }
        });
        if (rowIssues.length) throw new OrderCreateError(rowIssues);
        const duplicateIssues = await findDuplicateIssues(tx, date, rows);
        const creditIssues = priced
          ? await findCreditLimitIssues(tx, parties, rows, today)
          : [];
        if (duplicateIssues.length || creditIssues.length) {
          throw new OrderCreateError([...duplicateIssues, ...creditIssues]);
        }

        const company = await tx.companySettings.findUniqueOrThrow({
          where: { id: 1 },
          select: { orderPrefix: true, documentProfileId: true },
        });
        const yearText = businessDate.slice(0, 4);
        const year = Number(yearText);
        const { firstOrdinal } = await reserveNumberBlock(
          tx,
          "ORDER",
          year,
          rows.length,
        );
        const status = priced ? "POSTED" : "PENDING_PRICING";
        const records = rows.map((row, index) => {
          const ordinal = firstOrdinal + BigInt(index);
          return {
            row,
            id: randomUUID(),
            revisionId: randomUUID(),
            orderNo: `${company.orderPrefix}-${yearText}-${String(ordinal).padStart(4, "0")}`,
            ordinal,
          };
        });
        const resourceIds = records.map(({ id }) => id);
        await tx.order.createMany({
          data: records.map(({ id, row, orderNo, ordinal }) => ({
            id,
            orderNo,
            ordinal,
            numberYear: year,
            status,
            businessDate: date,
            customerId: row.customerId,
            supplierId: row.supplierId,
            mineId: row.mineId,
            vehicleNo: row.vehicleNo,
            biltyNo: row.biltyNo,
            createdById: actor.userId,
            updatedById: actor.userId,
          })),
        });
        await tx.orderRevision.createMany({
          data: records.map(({ id, revisionId, row }) => ({
            id: revisionId,
            orderId: id,
            revisionNo: 1,
            businessDate: date,
            customerId: row.customerId,
            supplierId: row.supplierId,
            mineId: row.mineId,
            vehicleNo: row.vehicleNo,
            biltyNo: row.biltyNo,
            notes: row.notes,
            weight: row.weight,
            purchaseRate: row.purchaseRate,
            sellRate: row.sellRate,
            buyAmount: row.buyAmount,
            sellAmount: row.sellAmount,
            profit: row.profit,
            documentProfileId: company.documentProfileId,
            actorId: actor.userId,
          })),
        });
        await tx.order.updateMany({
          where: { id: { in: resourceIds } },
          data: { currentRevisionNo: 1 },
        });
        if (priced) {
          await tx.ledgerEntry.createMany({
            data: records.flatMap(({ revisionId, row }) => {
              if (row.buyAmount === null || row.sellAmount === null) {
                throw new Error("A priced dispatch has no posting snapshot.");
              }
              return orderPostingRows({
                revisionId,
                businessDate: date,
                customerId: row.customerId,
                supplierId: row.supplierId,
                actorId: actor.userId,
                sellAmount: row.sellAmount,
                buyAmount: row.buyAmount,
              });
            }),
          });
        }
        await appendAuditEvents(
          tx,
          records.map(({ id, orderNo, row }) => ({
            ...request,
            actor: { type: "USER", id: actor.userId },
            action: "order.create",
            area: "dispatch",
            targetType: "order",
            targetId: id,
            outcome: "SUCCESS",
            after: {
              orderNo,
              businessDate,
              status,
              customerId: row.customerId,
              supplierId: row.supplierId,
              mineId: row.mineId,
              vehicleNo: row.vehicleNo,
              biltyNo: row.biltyNo,
              weight: row.weight,
              purchaseRate: row.purchaseRate,
              sellRate: row.sellRate,
              buyAmount: row.buyAmount,
              sellAmount: row.sellAmount,
              profit: row.profit,
              duplicateVehicleConfirmed: row.confirmDuplicateVehicle,
              creditLimitConfirmed: row.confirmCreditLimit,
            },
          })),
        );
        return { resourceIds };
      },
      (tx) => requireLivePermission(tx, actor, "orders.create", now),
    );
    return { orderIds: result.resourceIds };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      throw new OrderCreateError([{ field: "businessDate", code: "closed" }]);
    }
    if (error instanceof IdempotencyConflictError) {
      throw new OrderCreateError([{ field: "key", code: "invalid" }]);
    }
    throw error;
  }
}
