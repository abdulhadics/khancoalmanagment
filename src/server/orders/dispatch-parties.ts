import { Prisma } from "../../generated/prisma/client";
import {
  DispatchInputError,
  duplicateVehicleKey,
  type PreparedDispatchRow,
} from "./dispatch-input";

type PartyReferences = Pick<
  PreparedDispatchRow,
  "customerId" | "supplierId" | "mineId"
>;

export async function lockDispatchParties(
  tx: Prisma.TransactionClient,
  rows: readonly PartyReferences[],
) {
  const customerIds = [...new Set(rows.map(({ customerId }) => customerId))];
  const supplierIds = [...new Set(rows.map(({ supplierId }) => supplierId))];
  const mineIds = [
    ...new Set(rows.flatMap(({ mineId }) => (mineId === null ? [] : [mineId]))),
  ];

  // Customer locks precede supplier locks in every posting workflow.
  if (customerIds.length) {
    await tx.$queryRaw`
      SELECT id FROM customers
      WHERE id IN (${Prisma.join(customerIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE
    `;
  }
  if (supplierIds.length) {
    await tx.$queryRaw`
      SELECT id FROM suppliers
      WHERE id IN (${Prisma.join(supplierIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE
    `;
  }

  const customers = await tx.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, isActive: true, creditLimit: true },
  });
  const suppliers = await tx.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, isActive: true },
  });
  const mines = await tx.mine.findMany({
    where: {
      supplierId: { in: supplierIds },
      OR: [{ id: { in: mineIds } }, { isDefault: true }],
    },
    select: { id: true, supplierId: true, isDefault: true, isActive: true },
  });
  return {
    customers: new Map(customers.map((customer) => [customer.id, customer])),
    suppliers: new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    mines: new Map(mines.map((mine) => [mine.id, mine])),
    defaults: new Map(
      mines
        .filter((mine) => mine.isDefault && mine.isActive)
        .map((mine) => [mine.supplierId, mine]),
    ),
  };
}

export function resolveDispatchMine(
  parties: Awaited<ReturnType<typeof lockDispatchParties>>,
  row: PartyReferences,
) {
  if (!parties.customers.get(row.customerId)?.isActive) {
    throw new DispatchInputError("customerId", "missingOrInactive");
  }
  if (!parties.suppliers.get(row.supplierId)?.isActive) {
    throw new DispatchInputError("supplierId", "missingOrInactive");
  }
  if (!row.mineId) {
    const fallback = parties.defaults.get(row.supplierId);
    if (!fallback) throw new DispatchInputError("mineId", "mineRequired");
    return fallback.id;
  }
  const mine = parties.mines.get(row.mineId);
  if (!mine?.isActive || mine.supplierId !== row.supplierId) {
    throw new DispatchInputError("mineId", "missingOrInactive");
  }
  return mine.id;
}

export async function findVehicleDuplicates(
  tx: Prisma.TransactionClient,
  businessDate: Date,
  vehicleNos: readonly string[],
  excludeOrderId?: string,
) {
  const keys = [...new Set(vehicleNos.map(duplicateVehicleKey))];
  if (!keys.length) return new Set<string>();
  const exclusion = excludeOrderId
    ? Prisma.sql`AND id <> ${excludeOrderId}::uuid`
    : Prisma.empty;
  const rows = await tx.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT replace(vehicle_no, '-', '') AS key
    FROM orders
    WHERE business_date = ${businessDate}::date
      AND status <> 'VOIDED'
      AND replace(vehicle_no, '-', '') IN (${Prisma.join(keys)})
      ${exclusion}
  `;
  return new Set(rows.map(({ key }) => key));
}
