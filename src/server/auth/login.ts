import { verify } from "@node-rs/argon2";
import { isIP } from "node:net";

import type {
  Prisma,
  PrismaClient,
  RoleCode,
} from "../../generated/prisma/client";
import { readEnvironment } from "../config/env";
import { getDatabase } from "../db/client";
import { appendAuditEvent } from "../repositories/audit-log";
import { hashPassword } from "./password";
import { issueSession } from "./session";
import { takeAuthAttempt } from "./throttle";
import {
  generateOpaqueToken,
  issueAuthChallenge,
  lockAuthUser,
} from "./tokens";

type LoginInput = {
  identifier: string;
  password: string;
  requestId: string;
  ip?: string | null;
};

type LoginState = {
  userId: string;
  roleCode: RoleCode;
  mustChangePassword: boolean;
  hasTotp: boolean;
};

type LoginTransition =
  | { status: "success"; token: string }
  | { status: "password_change"; token: string }
  | { status: "totp_challenge"; token: string }
  | { status: "totp_enrollment"; token: string };

export type LoginResult = LoginTransition | { status: "invalid" };

let decoyHash: Promise<string> | undefined;

function decoyPasswordHash() {
  decoyHash ??= hashPassword(generateOpaqueToken());
  return decoyHash;
}

export async function completePasswordStage(
  tx: Prisma.TransactionClient,
  state: LoginState,
  enforceOwnerTotp: boolean,
  now = new Date(),
): Promise<LoginTransition> {
  const { userId } = state;
  // Existing second factors still apply to temporary passwords.
  if (state.hasTotp) {
    return {
      status: "totp_challenge",
      token: await issueAuthChallenge(tx, userId, "TOTP_CHALLENGE", now),
    };
  }
  if (state.mustChangePassword) {
    return {
      status: "password_change",
      token: await issueAuthChallenge(tx, userId, "PASSWORD_CHANGE", now),
    };
  }
  if (enforceOwnerTotp && state.roleCode === "OWNER") {
    return {
      status: "totp_enrollment",
      token: await issueAuthChallenge(tx, userId, "TOTP_ENROLLMENT", now),
    };
  }
  return { status: "success", token: await issueSession(tx, userId, now) };
}

async function recordLoginFailure(
  database: Prisma.TransactionClient,
  input: LoginInput,
  userId: string | undefined,
  denied = false,
): Promise<{ status: "invalid" }> {
  await appendAuditEvent(database, {
    actor: userId ? { type: "USER", id: userId } : { type: "ANONYMOUS" },
    area: "identity",
    action: "auth.login",
    targetType: "user",
    targetId: userId,
    requestId: input.requestId,
    ipAddress: input.ip && isIP(input.ip) ? input.ip : undefined,
    outcome: denied ? "DENIED" : "FAILURE",
  });
  return { status: "invalid" };
}

export async function loginWithPassword(
  input: LoginInput,
  database?: PrismaClient,
  options: { now?: Date; production?: boolean } = {},
): Promise<LoginResult> {
  const db = database ?? getDatabase();
  const now = options.now ?? new Date();
  const enforceOwnerTotp =
    options.production ?? readEnvironment().REQUIRE_OWNER_TOTP;
  const identifier =
    input.identifier.length <= 512 ? input.identifier.trim().toLowerCase() : "";
  const candidate =
    identifier.length > 0 && identifier.length <= 254
      ? await db.user.findUnique({
          where: identifier.includes("@")
            ? { email: identifier }
            : { username: identifier },
          select: {
            id: true,
            isActive: true,
            credential: { select: { passwordHash: true } },
          },
        })
      : null;
  const allowed = await takeAuthAttempt(
    db,
    "login",
    candidate?.id ?? identifier,
    input.ip,
    now,
  );
  if (!allowed) return recordLoginFailure(db, input, candidate?.id, true);

  const validPasswordInput =
    input.password.length > 0 && input.password.length <= 256;
  const decoy = await decoyPasswordHash();
  const checkedHash = candidate?.credential?.passwordHash ?? decoy;
  const password = validPasswordInput ? input.password : "";
  const matched = await verify(checkedHash, password).catch(() => false);
  if (
    !validPasswordInput ||
    !matched ||
    !candidate?.isActive ||
    !candidate.credential
  ) {
    return recordLoginFailure(db, input, candidate?.id);
  }

  return db.$transaction(async (tx) => {
    await lockAuthUser(tx, candidate.id);
    const current = await tx.user.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        isActive: true,
        roleCode: true,
        credential: {
          select: {
            passwordHash: true,
            mustChangePassword: true,
            totpKeyId: true,
          },
        },
      },
    });
    if (
      !current?.isActive ||
      current.credential?.passwordHash !== checkedHash
    ) {
      return recordLoginFailure(tx, input, current?.id);
    }

    const result = await completePasswordStage(
      tx,
      {
        userId: current.id,
        roleCode: current.roleCode,
        mustChangePassword: current.credential.mustChangePassword,
        hasTotp: current.credential.totpKeyId !== null,
      },
      enforceOwnerTotp,
      options.now ?? new Date(),
    );
    await appendAuditEvent(tx, {
      actor: { type: "USER", id: current.id },
      area: "identity",
      action:
        result.status === "success" ? "auth.login" : "auth.password-verified",
      targetType: "user",
      targetId: current.id,
      requestId: input.requestId,
      ipAddress: input.ip && isIP(input.ip) ? input.ip : undefined,
      outcome: "SUCCESS",
    });
    return result;
  });
}
