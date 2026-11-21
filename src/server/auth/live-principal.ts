import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client";
import {
  PermissionDenied,
  requirePermission,
  type Permission,
} from "../../domain/permissions";
import { readEnvironment } from "../config/env";
import { SESSION_IDLE_MS, type SessionActor } from "./session";
import { lockAuthUser } from "./tokens";

export type LivePrincipal = Pick<
  SessionActor,
  "sessionId" | "userId" | "roleCode"
>;

const sessionIdentifier = z.uuid();

export async function requireLivePermission(
  tx: Prisma.TransactionClient,
  actor: LivePrincipal,
  permission: Permission,
  now = new Date(),
  options: { actorLocked?: boolean } = {},
) {
  requirePermission(actor, permission);
  if (
    !sessionIdentifier.safeParse(actor.userId).success ||
    !sessionIdentifier.safeParse(actor.sessionId).success
  ) {
    throw new PermissionDenied();
  }

  if (!options.actorLocked) await lockAuthUser(tx, actor.userId);
  await tx.$queryRaw`
    SELECT id FROM sessions WHERE id = ${actor.sessionId}::uuid FOR UPDATE
  `;
  const requireTotp =
    actor.roleCode === "OWNER" &&
    readEnvironment().DEPLOYMENT_ENV === "production";

  const session = await tx.session.findFirst({
    where: {
      id: actor.sessionId,
      userId: actor.userId,
      revokedAt: null,
      issuedAt: { lte: now },
      expiresAt: { gt: now },
      lastUsedAt: { gt: new Date(now.getTime() - SESSION_IDLE_MS) },
      user: {
        roleCode: actor.roleCode,
        isActive: true,
        credential: {
          is: {
            mustChangePassword: false,
            ...(requireTotp ? { totpKeyId: { not: null } } : {}),
          },
        },
      },
    },
    select: { id: true },
  });
  if (!session) throw new PermissionDenied();
}
