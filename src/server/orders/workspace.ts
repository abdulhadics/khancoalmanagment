import { z } from "zod";
import { can, canAccessOrder, requirePermission } from "@/domain/permissions";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import type {
  OrderStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { SessionActor } from "@/server/auth/session";

const revisionFields = {
  revisionNo: true,
  weight: true,
  sellRate: true,
  sellAmount: true,
  notes: true,
} satisfies Prisma.OrderRevisionSelect;

const orderFields = {
  id: true,
  orderNo: true,
  status: true,
  businessDate: true,
  customerId: true,
  supplierId: true,
  mineId: true,
  vehicleNo: true,
  biltyNo: true,
  createdById: true,
  customer: { select: { name: true } },
  supplier: { select: { name: true } },
  mine: { select: { code: true } },
} satisfies Prisma.OrderSelect;

function selectedOrderFields(financial: boolean) {
  return {
    ...orderFields,
    currentRevision: {
      select: {
        ...revisionFields,
        purchaseRate: financial,
        buyAmount: financial,
        profit: financial,
      },
    },
  } satisfies Prisma.OrderSelect;
}

type OrderRead = Prisma.OrderGetPayload<{
  select: ReturnType<typeof selectedOrderFields>;
}>;

export type DispatchOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  businessDate: string;
  customerId: string;
  supplierId: string;
  mineId: string;
  customer: string;
  supplier: string;
  mine: string;
  createdById: string;
  vehicleNo: string;
  biltyNo: string;
  revisionNo: number;
  weight: string;
  sellRate: string;
  sellAmount?: string;
  purchaseRate?: string;
  buyAmount?: string;
  profit?: string;
  notes: string;
};

function dispatchOrder(row: OrderRead, financial: boolean): DispatchOrder {
  const revision = row.currentRevision;
  if (!revision) throw new Error("Dispatch revision is missing.");
  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    customerId: row.customerId,
    supplierId: row.supplierId,
    mineId: row.mineId,
    customer: row.customer.name,
    supplier: row.supplier.name,
    mine: row.mine.code,
    createdById: row.createdById,
    vehicleNo: row.vehicleNo,
    biltyNo: row.biltyNo ?? "",
    revisionNo: revision.revisionNo,
    weight: revision.weight.toFixed(3),
    sellRate: revision.sellRate?.toFixed(2) ?? "",
    sellAmount: revision.sellAmount?.toFixed(2),
    notes: revision.notes ?? "",
    ...(financial
      ? {
          purchaseRate: revision.purchaseRate?.toFixed(2),
          buyAmount: revision.buyAmount?.toFixed(2),
          profit: revision.profit?.toFixed(2),
        }
      : {}),
  };
}

export async function readDispatchOptions(
  db: PrismaClient,
  actor: SessionActor,
) {
  requirePermission(actor, "orders.create");
  const [customers, suppliers] = await Promise.all([
    db.customer.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    }),
    db.supplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        mines: {
          where: { isActive: true },
          select: { id: true, code: true, name: true, isDefault: true },
          orderBy: [{ isDefault: "desc" }, { codeKey: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    }),
  ]);
  return { customers, suppliers };
}

export type DispatchOptions = Awaited<ReturnType<typeof readDispatchOptions>>;

export async function readDailyOrders(
  db: PrismaClient,
  actor: SessionActor,
  dateKey: string,
  page: number,
) {
  requirePermission(actor, "orders.view");
  const businessDate = parseBusinessDate(dateKey);
  const pageSize = 25;
  if (actor.roleCode === "OPERATOR" && dateKey !== todayBusinessDate()) {
    return { rows: [], page: 1, pages: 1 };
  }
  const where: Prisma.OrderWhereInput = {
    businessDate,
    status: { not: "VOIDED" },
    ...(actor.roleCode === "OPERATOR" ? { createdById: actor.userId } : {}),
  };
  const financial = can(actor.roleCode, "orders.financial");
  return db.$transaction(
    async (tx) => {
      const count = await tx.order.count({ where });
      const pages = Math.max(1, Math.ceil(count / pageSize));
      const currentPage = Math.max(1, Math.min(page, pages));
      const rows = await tx.order.findMany({
        where,
        select: selectedOrderFields(financial),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
      });
      return {
        rows: rows.map((row) => dispatchOrder(row, financial)),
        page: currentPage,
        pages,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function readOrderForWorkspace(
  db: PrismaClient,
  actor: SessionActor,
  id: string,
) {
  requirePermission(actor, "orders.view");
  if (!z.uuid().safeParse(id).success) return null;
  const financial = can(actor.roleCode, "orders.financial");
  const row = await db.order.findUnique({
    where: { id },
    select: selectedOrderFields(financial),
  });
  if (!row || row.status === "VOIDED") return null;
  const resource = {
    createdById: row.createdById,
    status: row.status,
    businessDate: row.businessDate.toISOString().slice(0, 10),
  };
  if (!canAccessOrder(actor, "orders.view", resource, todayBusinessDate()))
    return null;
  return dispatchOrder(row, financial);
}
