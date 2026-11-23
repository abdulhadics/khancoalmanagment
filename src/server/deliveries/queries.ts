import { Decimal } from "decimal.js";
import { requirePermission } from "@/domain/permissions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LivePrincipal } from "../auth/live-principal";

export const deliveriesPageSize = 20;

export type DeliveryFilterOptions = {
  customerId?: string;
  status?: "pending" | "completed" | "all";
  page?: number;
};

export type DeliveryListItem = {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  businessDate: string;
  orderedWeight: string;
  deliveredWeight: string;
  remainingWeight: string;
  isComplete: boolean;
  notes: string | null;
  pickupsCount: number;
};

export type DeliveryPickupItem = {
  id: string;
  businessDate: string;
  weight: string;
  vehicleNo: string | null;
  notes: string | null;
  createdByName: string;
};

export async function readDeliveriesList(
  database: PrismaClient,
  actor: LivePrincipal,
  filters: DeliveryFilterOptions = {},
) {
  requirePermission(actor, "deliveries.view");

  const where: Prisma.DeliveryRecordWhereInput = {};

  if (filters.customerId) {
    where.customerId = filters.customerId;
  }

  if (filters.status === "completed") {
    where.isComplete = true;
  } else if (filters.status === "all") {
    // no filter on isComplete
  } else {
    // default: pending
    where.isComplete = false;
  }

  const page = Math.max(1, filters.page ?? 1);

  const [totalCount, pendingRecords, records] = await Promise.all([
    database.deliveryRecord.count({ where }),
    database.deliveryRecord.findMany({
      where: { isComplete: false },
      select: { orderedWeight: true, deliveredWeight: true },
    }),
    database.deliveryRecord.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * deliveriesPageSize,
      take: deliveriesPageSize,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        _count: { select: { pickups: true } },
      },
    }),
  ]);

  const totalRemaining = pendingRecords.reduce((sum, item) => {
    const rem = new Decimal(item.orderedWeight).minus(item.deliveredWeight);
    return sum.plus(Decimal.max(rem, 0));
  }, new Decimal(0));

  const lastPage = Math.max(1, Math.ceil(totalCount / deliveriesPageSize));

  const rows: DeliveryListItem[] = records.map((rec) => {
    const ordered = new Decimal(rec.orderedWeight);
    const delivered = new Decimal(rec.deliveredWeight);
    const remaining = Decimal.max(ordered.minus(delivered), 0);

    return {
      id: rec.id,
      customerId: rec.customer.id,
      customerName: rec.customer.name,
      customerCode: rec.customer.code,
      businessDate: rec.businessDate.toISOString().slice(0, 10),
      orderedWeight: ordered.toFixed(3),
      deliveredWeight: delivered.toFixed(3),
      remainingWeight: remaining.toFixed(3),
      isComplete: rec.isComplete,
      notes: rec.notes,
      pickupsCount: rec._count.pickups,
    };
  });

  return {
    rows,
    totalCount,
    totalRemainingWeight: totalRemaining.toFixed(3),
    pendingCount: pendingRecords.length,
    page,
    lastPage,
  };
}

export async function readDeliveryDetail(
  database: PrismaClient,
  actor: LivePrincipal,
  id: string,
) {
  requirePermission(actor, "deliveries.view");

  const rec = await database.deliveryRecord.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, code: true, phone: true } },
      pickups: {
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        include: {
          createdBy: { select: { displayName: true } },
        },
      },
    },
  });

  if (!rec) return null;

  const ordered = new Decimal(rec.orderedWeight);
  const delivered = new Decimal(rec.deliveredWeight);
  const remaining = Decimal.max(ordered.minus(delivered), 0);

  const pickups: DeliveryPickupItem[] = rec.pickups.map((p) => ({
    id: p.id,
    businessDate: p.businessDate.toISOString().slice(0, 10),
    weight: new Decimal(p.weight).toFixed(3),
    vehicleNo: p.vehicleNo,
    notes: p.notes,
    createdByName: p.createdBy.displayName,
  }));

  return {
    id: rec.id,
    customer: rec.customer,
    businessDate: rec.businessDate.toISOString().slice(0, 10),
    orderedWeight: ordered.toFixed(3),
    deliveredWeight: delivered.toFixed(3),
    remainingWeight: remaining.toFixed(3),
    isComplete: rec.isComplete,
    notes: rec.notes,
    pickups,
  };
}

export async function readActiveCustomers(database: PrismaClient) {
  return database.customer.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { nameKey: "asc" },
  });
}
