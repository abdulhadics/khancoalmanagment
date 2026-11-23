"use server";

import { revalidatePath } from "next/cache";
import {
  assertActionOrigin,
  requireActor,
} from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications/queries";

export async function markNotificationReadAction(id: string) {
  await assertActionOrigin();
  const actor = await requireActor();
  const db = getDatabase();

  await markNotificationRead(db, actor, id);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  await assertActionOrigin();
  const actor = await requireActor();
  const db = getDatabase();

  await markAllNotificationsRead(db, actor);
  revalidatePath("/", "layout");
}

export async function dismissNotificationAction(id: string) {
  await assertActionOrigin();
  const actor = await requireActor();
  const db = getDatabase();

  await dismissNotification(db, actor, id);
  revalidatePath("/", "layout");
}
