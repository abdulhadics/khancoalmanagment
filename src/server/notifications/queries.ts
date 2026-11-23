import { requirePermission } from "@/domain/permissions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LivePrincipal } from "../auth/live-principal";
import { syncSystemNotifications } from "./generator";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  customerId: string | null;
  supplierId: string | null;
  isRead: boolean;
  isDismissed: boolean;
  createdAt: string;
};

export async function readNotificationsList(
  database: PrismaClient,
  actor: LivePrincipal,
  filters: { unreadOnly?: boolean } = {},
) {
  requirePermission(actor, "notifications.view");

  try {
    // Sync latest system alerts dynamically
    await syncSystemNotifications(database).catch(() => {});

    const where: Prisma.NotificationWhereInput = {
      isDismissed: false,
    };

    if (filters.unreadOnly) {
      where.isRead = false;
    }

    const list = await database.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return list.map((item) => ({
      id: String(item.id),
      type: item.type,
      title: item.title,
      message: item.message,
      customerId: item.customerId,
      supplierId: item.supplierId,
      isRead: item.isRead,
      isDismissed: item.isDismissed,
      createdAt: item.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function readUnreadNotificationCount(
  database: PrismaClient,
  actor: LivePrincipal,
) {
  requirePermission(actor, "notifications.view");

  try {
    return await database.notification.count({
      where: {
        isRead: false,
        isDismissed: false,
      },
    });
  } catch {
    return 0;
  }
}

export async function markNotificationRead(
  database: PrismaClient,
  actor: LivePrincipal,
  notificationId: string,
) {
  requirePermission(actor, "notifications.view");

  await database.notification.update({
    where: { id: BigInt(notificationId) },
    data: { isRead: true },
  });

  return { success: true };
}

export async function markAllNotificationsRead(
  database: PrismaClient,
  actor: LivePrincipal,
) {
  requirePermission(actor, "notifications.view");

  await database.notification.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });

  return { success: true };
}

export async function dismissNotification(
  database: PrismaClient,
  actor: LivePrincipal,
  notificationId: string,
) {
  requirePermission(actor, "notifications.view");

  await database.notification.update({
    where: { id: BigInt(notificationId) },
    data: { isDismissed: true },
  });

  return { success: true };
}
