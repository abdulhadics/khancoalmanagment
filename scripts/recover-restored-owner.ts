import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/server/auth/password";
import { readEnvironment } from "../src/server/config/env";
import { makePrisma } from "../src/server/db/connect";
import { appendAuditEvent } from "../src/server/repositories/audit-log";

import {
  OwnerRecoveryError,
  readRecoveryPassword,
} from "./owner-recovery-input";

async function run() {
  const [target, username] = process.argv.slice(2);
  if (!target || !/^[a-z][a-z0-9_]{0,62}$/.test(target) || !username?.trim()) {
    throw new OwnerRecoveryError(
      "Provide the exact restored database name and restored Owner username.",
    );
  }
  const { DATABASE_URL } = readEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
  });
  if (!DATABASE_URL)
    throw new OwnerRecoveryError("Set DATABASE_URL to the restored database.");
  const url = new URL(DATABASE_URL);
  if (
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== `/${target}`
  ) {
    throw new OwnerRecoveryError(
      "DATABASE_URL must match the named local recovery database.",
    );
  }
  const passwordHash = await hashPassword(await readRecoveryPassword());
  const database = makePrisma(DATABASE_URL);
  try {
    const requestId = randomUUID();
    await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(3091736130::bigint)`;
      const restore = await tx.auditLog.findFirst({
        where: {
          action: "backup.restore",
          actorType: "SYSTEM",
          outcome: "SUCCESS",
        },
        select: { id: true },
      });
      const [credential, session] = await Promise.all([
        tx.userCredential.findFirst({ select: { userId: true } }),
        tx.session.findFirst({ select: { id: true } }),
      ]);
      if (!restore || credential || session) {
        throw new OwnerRecoveryError(
          "Owner recovery requires a verified restore with no existing credentials or sessions.",
        );
      }
      const owner = await tx.user.findUnique({
        where: {
          username: username.trim().toLowerCase(),
          roleCode: "OWNER",
          isActive: true,
        },
        select: { id: true },
      });
      if (!owner)
        throw new OwnerRecoveryError(
          "Use the username of an active Owner in the restored database.",
        );
      await tx.userCredential.create({
        data: { userId: owner.id, passwordHash, mustChangePassword: true },
      });
      await appendAuditEvent(tx, {
        actor: { type: "SYSTEM" },
        area: "identity",
        action: "owner.restore-access",
        targetType: "user",
        targetId: owner.id,
        requestId,
        outcome: "SUCCESS",
      });
    });
  } finally {
    await database.$disconnect();
  }
  console.log(
    "Owner access restored. Change the temporary password and enroll two-factor authentication after signing in.",
  );
}

try {
  await run();
} catch (error) {
  console.error(
    error instanceof OwnerRecoveryError
      ? error.message
      : "Owner recovery failed. Check the restored database connection and verified restore record.",
  );
  process.exitCode = 1;
}
