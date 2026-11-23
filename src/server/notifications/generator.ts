import { todayBusinessDate } from "@/domain/business-date";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import type { PrismaClient } from "@/generated/prisma/client";
import { partyBalancesQuery } from "../repositories/party-ledger-rollups";
import { readDocumentDisplayPreferences } from "../settings/company";

export async function syncSystemNotifications(
  database: PrismaClient,
  today: string = todayBusinessDate(),
) {
  const preferences = await readDocumentDisplayPreferences(database);

  // 1. Check Customer Overdue Balances
  const customerDues = await database.$queryRaw<
    Array<{ customer_id: string; balance: string }>
  >`
    SELECT customer_id, balance::text
    FROM (${partyBalancesQuery(today)}) AS b
    WHERE customer_id IS NOT NULL AND balance > 0
  `;

  for (const { customer_id, balance } of customerDues) {
    const existing = await database.notification.findFirst({
      where: {
        customerId: customer_id,
        type: "CUSTOMER_OVERDUE",
        isDismissed: false,
      },
      select: { id: true },
    });

    if (!existing) {
      const customer = await database.customer.findUnique({
        where: { id: customer_id },
        select: { name: true, code: true, phone: true },
      });

      if (customer) {
        const formattedAmount = formatCurrency(balance, preferences);
        await database.notification.create({
          data: {
            type: "CUSTOMER_OVERDUE",
            customerId: customer_id,
            title: `Receivable Due: ${customer.name} (${customer.code})`,
            message: `Customer ${customer.name} has an outstanding unpaid balance of ${formattedAmount}. Please follow up for collection.`,
          },
        });
      }
    }
  }

  // 2. Check Supplier / Miner Overdue Payables
  const supplierDues = await database.$queryRaw<
    Array<{ supplier_id: string; balance: string }>
  >`
    SELECT supplier_id, balance::text
    FROM (${partyBalancesQuery(today)}) AS b
    WHERE supplier_id IS NOT NULL AND balance > 0
  `;

  for (const { supplier_id, balance } of supplierDues) {
    const existing = await database.notification.findFirst({
      where: {
        supplierId: supplier_id,
        type: "SUPPLIER_OVERDUE",
        isDismissed: false,
      },
      select: { id: true },
    });

    if (!existing) {
      const supplier = await database.supplier.findUnique({
        where: { id: supplier_id },
        select: {
          name: true,
          code: true,
          region: true,
          mines: { where: { isActive: true }, select: { name: true, code: true } },
        },
      });

      if (supplier) {
        const formattedAmount = formatCurrency(balance, preferences);
        const minesList = supplier.mines.length > 0
          ? ` (Mines: ${supplier.mines.map((m) => m.name).join(", ")})`
          : "";
        await database.notification.create({
          data: {
            type: "SUPPLIER_OVERDUE",
            supplierId: supplier_id,
            title: `Payable Due: ${supplier.name}${minesList}`,
            message: `You owe ${supplier.name} an outstanding payable amount of ${formattedAmount} for coal purchases. Payment is due.`,
          },
        });
      }
    }
  }

  // 3. Check Pending Deliveries (Customer purchased coal awaiting pickup)
  const pendingDeliveries = await database.deliveryRecord.findMany({
    where: { isComplete: false },
    include: {
      customer: { select: { id: true, name: true, code: true } },
    },
  });

  for (const delivery of pendingDeliveries) {
    const remaining = Number(delivery.orderedWeight) - Number(delivery.deliveredWeight);
    if (remaining > 0) {
      const existing = await database.notification.findFirst({
        where: {
          customerId: delivery.customerId,
          type: "DELIVERY_PENDING",
          isDismissed: false,
        },
        select: { id: true },
      });

      if (!existing) {
        const formattedWeight = `${formatDecimal(String(remaining), 3, preferences.numberFormat)} TON`;
        await database.notification.create({
          data: {
            type: "DELIVERY_PENDING",
            customerId: delivery.customerId,
            title: `Pending Pickup: ${delivery.customer.name}`,
            message: `Customer ${delivery.customer.name} has ${formattedWeight} of purchased coal remaining at yard awaiting pickup.`,
          },
        });
      }
    }
  }
}
