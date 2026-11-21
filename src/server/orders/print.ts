import { Decimal } from "decimal.js";
import { z } from "zod";

import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { can, PermissionDenied } from "@/domain/permissions";
import type {
  OrderStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { SessionActor } from "@/server/auth/session";
import {
  documentProfileFields,
  readDocumentForPrint,
  type DocumentProfile,
  type PrintContext,
} from "@/server/documents/print-data";
import { appendAuditEvent } from "@/server/repositories/audit-log";

const maxDailyRows = 1_000;
const permission = "orders.print";
const orderId = z.uuid();
const Amount = Decimal.clone({ precision: 40 });
type PrintErrorCode = "unavailable" | "invalidDate" | "tooMany";

export class DispatchPrintError extends Error {
  constructor(readonly code: PrintErrorCode) {
    super(code);
    this.name = "DispatchPrintError";
  }
}

export type DispatchSummaryRow = {
  orderNo: string;
  customer: string;
  supplier: string;
  mine: string;
  vehicle: string;
  status: OrderStatus;
  weight: string;
  financial?: {
    buy: string | null;
    sell: string | null;
    profit: string | null;
  };
};

export type SlipPrintData = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
  date: Date;
  row: DispatchSummaryRow;
  bilty: string | null;
  notes: string | null;
};

type DailyPrintBase = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
  date: Date;
  rows: DispatchSummaryRow[];
};

export type DailyPrintData = DailyPrintBase &
  (
    | {
        financial: true;
        totals: { weight: string; buy: string; sell: string; profit: string };
      }
    | { financial: false; totals: { weight: string } }
  );

const summaryFields = {
  orderNo: true,
  customer: { select: { name: true } },
  supplier: { select: { name: true } },
  mine: { select: { name: true } },
  status: true,
  vehicleNo: true,
} satisfies Prisma.OrderSelect;

type Summary = Prisma.OrderGetPayload<{ select: typeof summaryFields }>;

function describeOrder(order: Summary, weight: Decimal): DispatchSummaryRow {
  return {
    orderNo: order.orderNo,
    customer: order.customer.name,
    supplier: order.supplier.name,
    mine: order.mine.name,
    status: order.status,
    vehicle: order.vehicleNo,
    weight: weight.toFixed(3),
  };
}

function activeScope(actor: SessionActor, now: Date): Prisma.OrderWhereInput {
  return {
    status: { not: "VOIDED" },
    ...(actor.roleCode === "OPERATOR" && {
      createdById: actor.userId,
      businessDate: parseBusinessDate(todayBusinessDate(now)),
    }),
  };
}

export async function readDispatchSlip(
  database: PrismaClient,
  actor: SessionActor,
  id: string,
  context: PrintContext,
  now = new Date(),
): Promise<SlipPrintData> {
  if (!orderId.safeParse(id).success)
    throw new DispatchPrintError("unavailable");
  return readDocumentForPrint(
    database,
    actor,
    permission,
    context,
    now,
    async (tx) => {
      const record = await tx.order.findFirst({
        where: { id, ...activeScope(actor, now) },
        select: {
          ...summaryFields,
          businessDate: true,
          biltyNo: true,
          currentRevision: {
            select: {
              weight: true,
              notes: true,
              actor: { select: { displayName: true } },
              documentProfile: { select: documentProfileFields },
            },
          },
        },
      });
      const revision = record?.currentRevision;
      if (!record || !revision) throw new DispatchPrintError("unavailable");

      await appendAuditEvent(tx, {
        ...context,
        actor: { type: "USER", id: actor.userId },
        area: "orders",
        action: "order.slip-print",
        targetType: "order",
        targetId: id,
        outcome: "SUCCESS",
      });
      return {
        profile: revision.documentProfile,
        generatedAt: now,
        preparedBy: revision.actor.displayName,
        date: record.businessDate,
        row: describeOrder(record, revision.weight),
        bilty: record.biltyNo,
        notes: revision.notes,
      };
    },
  );
}

export async function readDailyDispatch(
  database: PrismaClient,
  actor: SessionActor,
  dateKey: string,
  context: PrintContext,
  now = new Date(),
): Promise<DailyPrintData> {
  let date: Date;
  try {
    date = parseBusinessDate(dateKey);
  } catch {
    throw new DispatchPrintError("invalidDate");
  }
  if (actor.roleCode === "OPERATOR" && dateKey !== todayBusinessDate(now)) {
    throw new PermissionDenied();
  }
  return readDocumentForPrint(
    database,
    actor,
    permission,
    context,
    now,
    async (tx) => {
      const settings = await tx.companySettings.findUnique({
        where: { id: 1 },
        select: { documentProfile: { select: documentProfileFields } },
      });
      if (!settings) throw new DispatchPrintError("unavailable");
      const financial = can(actor.roleCode, "orders.financial");
      const records = await tx.order.findMany({
        where: { ...activeScope(actor, now), businessDate: date },
        take: maxDailyRows + 1,
        orderBy: [{ ordinal: "asc" }, { id: "asc" }],
        select: {
          ...summaryFields,
          currentRevision: {
            select: {
              weight: true,
              buyAmount: financial,
              sellAmount: financial,
              profit: financial,
            },
          },
        },
      });
      if (records.length > maxDailyRows)
        throw new DispatchPrintError("tooMany");

      let totalWeight = new Amount(0);
      let totalBuy = new Amount(0);
      let totalSell = new Amount(0);
      let totalProfit = new Amount(0);
      const rows = records.map((record) => {
        const revision = record.currentRevision;
        if (!revision) throw new DispatchPrintError("unavailable");
        const row = describeOrder(record, revision.weight);
        totalWeight = totalWeight.plus(row.weight);
        if (financial) {
          const buy = revision.buyAmount?.toFixed(2) ?? null;
          const sell = revision.sellAmount?.toFixed(2) ?? null;
          const profit = revision.profit?.toFixed(2) ?? null;
          totalBuy = totalBuy.plus(buy ?? 0);
          totalSell = totalSell.plus(sell ?? 0);
          totalProfit = totalProfit.plus(profit ?? 0);
          row.financial = { buy, sell, profit };
        }
        return row;
      });

      await appendAuditEvent(tx, {
        ...context,
        actor: { type: "USER", id: actor.userId },
        area: "orders",
        action: "order.daily-print",
        targetType: "dispatch_date",
        targetId: dateKey,
        outcome: "SUCCESS",
        after: { dispatchCount: rows.length },
      });
      const base = {
        profile: settings.documentProfile,
        generatedAt: now,
        preparedBy: actor.displayName,
        date,
        rows,
      };
      const weight = totalWeight.toFixed(3);
      if (!financial) return { ...base, financial: false, totals: { weight } };
      return {
        ...base,
        financial: true,
        totals: {
          weight,
          buy: totalBuy.toFixed(2),
          sell: totalSell.toFixed(2),
          profit: totalProfit.toFixed(2),
        },
      };
    },
  );
}
