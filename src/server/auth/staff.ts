import { z } from "zod";
import { PermissionDenied, requirePermission } from "@/domain/permissions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { RoleCode } from "@/generated/prisma/enums";
import { readEnvironment } from "@/server/config/env";
import { appendAuditEvent } from "@/server/repositories/audit-log";
import { hashPassword, newPasswordSchema } from "./password";
import {
  revokeAllSessions,
  SESSION_IDLE_MS,
  type SessionActor,
} from "./session";
import { lockAuthUser } from "./tokens";

const role = z.enum(RoleCode);
const userId = z.uuid();

const commandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    displayName: z.string().trim().min(1).max(120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    roleCode: role,
    password: newPasswordSchema,
  }),
  z.object({
    operation: z.literal("access"),
    userId,
    roleCode: role,
    isActive: z.boolean(),
  }),
  z.object({
    operation: z.literal("reset"),
    userId,
    password: newPasswordSchema,
  }),
]);

export type StaffErrorCode = "invalid" | "duplicate" | "missing" | "lastOwner";

export class StaffError extends Error {
  constructor(
    readonly code: StaffErrorCode,
    readonly fields: readonly string[] = [],
  ) {
    super(code);
    this.name = "StaffError";
  }
}

type StaffActor = Pick<SessionActor, "userId" | "roleCode" | "sessionId">;

type StaffRequest = {
  requestId: string;
  ipAddress?: string;
};

const staffFields = {
  id: true,
  displayName: true,
  username: true,
  email: true,
  roleCode: true,
  isActive: true,
  lastLoginAt: true,
} as const satisfies Prisma.UserSelect;

export type StaffMember = Prisma.UserGetPayload<{ select: typeof staffFields }>;

async function verifyOwner(
  database: PrismaClient | Prisma.TransactionClient,
  actor: StaffActor,
) {
  const now = new Date();
  const enforceOwnerTotp = readEnvironment().REQUIRE_OWNER_TOTP;
  const session = await database.session.findFirst({
    where: {
      id: actor.sessionId,
      userId: actor.userId,
      revokedAt: null,
      issuedAt: { lte: now },
      expiresAt: { gt: now },
      lastUsedAt: { gt: new Date(now.getTime() - SESSION_IDLE_MS) },
      user: {
        roleCode: "OWNER",
        isActive: true,
        credential: {
          is: {
            mustChangePassword: false,
            ...(enforceOwnerTotp ? { totpKeyId: { not: null } } : {}),
          },
        },
      },
    },
    select: { id: true },
  });
  if (!session) throw new PermissionDenied();
}

export async function listStaff(database: PrismaClient, actor: StaffActor) {
  requirePermission(actor, "staff.manage");
  await verifyOwner(database, actor);
  return database.user.findMany({
    orderBy: [{ isActive: "desc" }, { displayName: "asc" }, { id: "asc" }],
    select: staffFields,
  });
}

export async function readStaff(
  database: PrismaClient,
  actor: StaffActor,
  id: string,
) {
  requirePermission(actor, "staff.manage");
  await verifyOwner(database, actor);
  if (!userId.safeParse(id).success) return null;
  return database.user.findUnique({ where: { id }, select: staffFields });
}

const ownerAdministrationLock = 3_091_736_129n; // Also used by first-Owner setup.

export async function mutateStaff(
  database: PrismaClient,
  actor: StaffActor,
  request: StaffRequest,
  rawCommand: unknown,
): Promise<{ staffId: string; reauthenticate: boolean }> {
  requirePermission(actor, "staff.manage");
  const result = commandSchema.safeParse(rawCommand);
  if (!result.success) {
    throw new StaffError(
      "invalid",
      result.error.issues.map(({ path }) => String(path[0])),
    );
  }

  const command = result.data;
  const passwordHash =
    "password" in command ? await hashPassword(command.password) : undefined;

  try {
    return await database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${ownerAdministrationLock})`;
        const subjects = new Set([actor.userId]);
        if ("userId" in command) subjects.add(command.userId);
        for (const subject of [...subjects].sort())
          await lockAuthUser(tx, subject);
        await verifyOwner(tx, actor);

        const event = {
          actor: { type: "USER", id: actor.userId },
          area: "identity",
          targetType: "user",
          outcome: "SUCCESS",
          ...request,
        } as const;

        if (command.operation === "create") {
          const { displayName, username, email, roleCode } = command;
          if (!passwordHash) throw new Error("Missing staff credential hash.");
          const created = await tx.user.create({
            data: {
              displayName,
              username,
              email,
              roleCode,
              credential: {
                create: { passwordHash, mustChangePassword: true },
              },
            },
            select: { id: true },
          });
          await appendAuditEvent(tx, {
            ...event,
            action: "staff.create",
            targetId: created.id,
            after: { roleCode, isActive: true },
          });
          return { staffId: created.id, reauthenticate: false };
        }

        const target = await tx.user.findUnique({
          where: { id: command.userId },
          select: staffFields,
        });
        if (!target) throw new StaffError("missing");

        if (command.operation === "access") {
          const { roleCode, isActive } = command;
          if (roleCode === target.roleCode && isActive === target.isActive) {
            return { staffId: target.id, reauthenticate: false };
          }
          if (
            target.isActive &&
            target.roleCode === "OWNER" &&
            (!isActive || roleCode !== "OWNER")
          ) {
            const others = await tx.user.count({
              where: {
                roleCode: "OWNER",
                isActive: true,
                id: { not: target.id },
              },
            });
            if (others === 0) throw new StaffError("lastOwner");
          }
          await tx.user.update({
            where: { id: target.id },
            data: { roleCode, isActive },
          });
          await appendAuditEvent(tx, {
            ...event,
            action: "staff.access",
            targetId: target.id,
            before: { roleCode: target.roleCode, isActive: target.isActive },
            after: { roleCode, isActive },
          });
        } else {
          if (!passwordHash) throw new Error("Missing staff credential hash.");
          await tx.userCredential.upsert({
            where: { userId: target.id },
            create: {
              userId: target.id,
              passwordHash,
              mustChangePassword: true,
            },
            update: { passwordHash, mustChangePassword: true },
          });
          await appendAuditEvent(tx, {
            ...event,
            action: "staff.reset",
            targetId: target.id,
          });
        }

        const now = new Date();
        await revokeAllSessions(tx, target.id, now);
        await tx.authChallenge.updateMany({
          where: { userId: target.id, consumedAt: null },
          data: { consumedAt: now },
        });
        return {
          staffId: target.id,
          reauthenticate: actor.userId === target.id,
        };
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new StaffError("duplicate", ["username", "email"]);
    }
    throw error;
  }
}
