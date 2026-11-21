import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client";
import { appendAuditEvent } from "../repositories/audit-log";
import { hashPassword, newPasswordSchema } from "./password";

const ownerEnvironment = z.object({
  OWNER_EMAIL: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  OWNER_USERNAME: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  OWNER_DISPLAY_NAME: z.string().trim().min(1).max(120),
  OWNER_PASSWORD: newPasswordSchema,
});

export class OwnerBootstrapError extends Error {}

export function readOwnerBootstrapInput(
  values: Readonly<Record<string, string | undefined>>,
) {
  const result = ownerEnvironment.safeParse(values);
  if (!result.success) {
    const keys = new Set(result.error.issues.map(({ path }) => path.join(".")));
    throw new OwnerBootstrapError(
      `Set valid first-Owner values for ${Array.from(keys).join(", ")}.`,
    );
  }
  return {
    email: result.data.OWNER_EMAIL,
    username: result.data.OWNER_USERNAME,
    displayName: result.data.OWNER_DISPLAY_NAME,
    password: result.data.OWNER_PASSWORD,
  };
}

const ownerBootstrapLock = 3_091_736_129n;

export async function seedFirstOwner(
  database: PrismaClient,
  input: ReturnType<typeof readOwnerBootstrapInput>,
) {
  const passwordHash = await hashPassword(input.password);

  return database.$transaction(
    async (tx) => {
      // Serialize separate bootstrap processes until the first Owner commits.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${ownerBootstrapLock})`;
      const existing = await tx.user.findFirst({
        where: { roleCode: "OWNER" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { email: true, username: true },
      });
      if (existing) {
        if (
          existing.email === input.email &&
          existing.username === input.username
        ) {
          return "already-present";
        }
        throw new OwnerBootstrapError("The first Owner already exists.");
      }

      const owner = await tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          displayName: input.displayName,
          roleCode: "OWNER",
        },
        select: { id: true },
      });
      await tx.userCredential.create({
        data: {
          userId: owner.id,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await appendAuditEvent(tx, {
        actor: { type: "SYSTEM" },
        area: "identity",
        action: "owner.bootstrap",
        targetType: "user",
        targetId: owner.id,
        requestId: randomUUID(),
        outcome: "SUCCESS",
        after: { roleCode: "OWNER", isActive: true },
      });
      return "created";
    },
    { isolationLevel: "ReadCommitted" },
  );
}
