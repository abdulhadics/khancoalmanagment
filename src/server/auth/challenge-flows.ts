import { randomUUID } from "node:crypto";

import { verify } from "@node-rs/argon2";

import type {
  AuthChallengePurpose,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { appendAuditEvent } from "../repositories/audit-log";
import { completePasswordStage } from "./login";
import { hashPassword, newPasswordSchema } from "./password";
import {
  issueSession,
  revokeAllSessions,
  SESSION_IDLE_MS,
  type SessionActor,
} from "./session";
import { takeAuthAttempt } from "./throttle";
import {
  digestToken,
  isOpaqueToken,
  issueAuthChallenge,
  lockAuthUser,
} from "./tokens";
import {
  decryptTotpSecret,
  deriveTotpEnrollmentSecret,
  encryptTotpSecret,
  totpProvisioningData,
  TOTP_KEY_ID,
  verifyTotpStep,
} from "./totp";

export interface AuthFlowContext {
  now?: Date;
  ipAddress?: string;
  requestId?: string;
}

const maxChallengeAttempts = 5;
const challengeFields = {
  id: true,
  purpose: true,
  userId: true,
  createdAt: true,
  expiresAt: true,
  consumedAt: true,
  attempts: true,
  user: {
    select: {
      username: true,
      isActive: true,
      roleCode: true,
      credential: {
        select: {
          passwordHash: true,
          mustChangePassword: true,
          totpSecretEncrypted: true,
          totpKeyId: true,
          lastTotpStep: true,
        },
      },
    },
  },
} satisfies Prisma.AuthChallengeSelect;

async function readChallenge(
  database: Pick<Prisma.TransactionClient, "authChallenge">,
  token: string,
  purpose: AuthChallengePurpose,
  now: Date,
) {
  if (!isOpaqueToken(token)) return null;
  const challenge = await database.authChallenge.findUnique({
    where: { tokenDigest: digestToken(token) },
    select: challengeFields,
  });
  if (
    !challenge ||
    challenge.purpose !== purpose ||
    challenge.consumedAt ||
    challenge.createdAt > now ||
    challenge.expiresAt <= now ||
    challenge.attempts >= maxChallengeAttempts ||
    !challenge.user.isActive
  ) {
    return null;
  }
  return challenge;
}

export async function lockChallenge(
  tx: Prisma.TransactionClient,
  token: string,
  purpose: AuthChallengePurpose,
  now: Date,
) {
  const challenge = await readChallenge(tx, token, purpose, now);
  if (!challenge) return null;
  await lockAuthUser(tx, challenge.userId);
  return readChallenge(tx, token, purpose, now);
}

export async function revokeAuthenticationState(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  await revokeAllSessions(tx, userId, now);
  await tx.$executeRaw`
    UPDATE auth_challenges
    SET consumed_at = GREATEST(created_at, ${now})
    WHERE user_id = ${userId}::uuid AND consumed_at IS NULL
  `;
}

async function auditChallenge(
  tx: Prisma.TransactionClient,
  context: AuthFlowContext,
  userId: string,
  action: string,
  success: boolean,
) {
  await appendAuditEvent(tx, {
    actor: success ? { type: "USER", id: userId } : { type: "ANONYMOUS" },
    area: "identity",
    action,
    targetType: "user",
    targetId: userId,
    requestId: context.requestId ?? randomUUID(),
    ipAddress: context.ipAddress,
    outcome: success ? "SUCCESS" : "FAILURE",
  });
}

async function recordChallengeFailure(
  tx: Prisma.TransactionClient,
  challenge: { id: string; userId: string },
  context: AuthFlowContext,
  action: string,
) {
  await tx.authChallenge.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
  });
  await auditChallenge(tx, context, challenge.userId, action, false);
}

export async function completeForcedPasswordChange(
  database: PrismaClient,
  input: AuthFlowContext & {
    challengeToken: string;
    newPassword: string;
    enforceOwnerTotp: boolean;
  },
) {
  const password = newPasswordSchema.safeParse(input.newPassword);
  if (!password.success) return null;
  const now = input.now ?? new Date();

  return database.$transaction(async (tx) => {
    const challenge = await lockChallenge(
      tx,
      input.challengeToken,
      "PASSWORD_CHANGE",
      now,
    );
    const credential = challenge?.user.credential;
    if (!challenge || !credential?.mustChangePassword) return null;
    const action = "auth.password.change";
    if (await verify(credential.passwordHash, password.data)) {
      await recordChallengeFailure(tx, challenge, input, action);
      return null;
    }
    const passwordHash = await hashPassword(password.data);
    await tx.userCredential.update({
      where: { userId: challenge.userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await revokeAuthenticationState(tx, challenge.userId, now);
    await auditChallenge(tx, input, challenge.userId, action, true);

    // An enrolled account only receives this challenge after its second factor.
    if (credential.totpSecretEncrypted) {
      return {
        status: "success" as const,
        token: await issueSession(tx, challenge.userId, now),
      };
    }
    return completePasswordStage(
      tx,
      {
        userId: challenge.userId,
        roleCode: challenge.user.roleCode,
        mustChangePassword: false,
        hasTotp: false,
      },
      input.enforceOwnerTotp,
      now,
    );
  });
}

export async function readTotpSetup(
  database: PrismaClient,
  challengeToken: string,
  encryptionKey: Buffer,
  now = new Date(),
) {
  const challenge = await readChallenge(
    database,
    challengeToken,
    "TOTP_ENROLLMENT",
    now,
  );
  const credential = challenge?.user.credential;
  if (!challenge || !credential || credential.totpSecretEncrypted) return null;
  if (credential.mustChangePassword) return null;
  const secret = deriveTotpEnrollmentSecret(encryptionKey, challengeToken);
  return totpProvisioningData(secret, challenge.user.username);
}

interface TotpCompletion extends AuthFlowContext {
  challengeToken: string;
  code: string;
  encryptionKey: Buffer;
}

export function completeTotpEnrollment(
  database: PrismaClient,
  input: TotpCompletion,
) {
  return completeTotp(database, input, "TOTP_ENROLLMENT");
}

export function completeTotpChallenge(
  database: PrismaClient,
  input: TotpCompletion,
) {
  return completeTotp(database, input, "TOTP_CHALLENGE");
}

async function completeTotp(
  database: PrismaClient,
  input: TotpCompletion,
  purpose: "TOTP_CHALLENGE" | "TOTP_ENROLLMENT",
) {
  const now = input.now ?? new Date();
  const enrolling = purpose === "TOTP_ENROLLMENT";
  const action = enrolling ? "auth.totp.enroll" : "auth.totp.verify";

  return database.$transaction(async (tx) => {
    const challenge = await lockChallenge(
      tx,
      input.challengeToken,
      purpose,
      now,
    );
    const credential = challenge?.user.credential;
    if (!challenge || !credential) return null;

    let secret: Buffer;
    if (enrolling) {
      if (credential.totpSecretEncrypted || credential.mustChangePassword)
        return null;
      secret = deriveTotpEnrollmentSecret(
        input.encryptionKey,
        input.challengeToken,
      );
    } else {
      if (
        !credential.totpSecretEncrypted ||
        credential.totpKeyId !== TOTP_KEY_ID
      ) {
        return null;
      }
      try {
        secret = decryptTotpSecret(
          credential.totpSecretEncrypted,
          input.encryptionKey,
          challenge.userId,
        );
      } catch {
        await recordChallengeFailure(tx, challenge, input, action);
        return null;
      }
    }
    const step = verifyTotpStep(
      secret,
      input.code,
      now,
      credential.lastTotpStep,
    );
    if (step === null) {
      await recordChallengeFailure(tx, challenge, input, action);
      return null;
    }

    await tx.userCredential.update({
      where: { userId: challenge.userId },
      data: {
        lastTotpStep: step,
        ...(enrolling && {
          totpSecretEncrypted: encryptTotpSecret(
            secret,
            input.encryptionKey,
            challenge.userId,
          ),
          totpKeyId: TOTP_KEY_ID,
        }),
      },
    });
    if (enrolling) {
      await revokeAuthenticationState(tx, challenge.userId, now);
    } else {
      await tx.authChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
    }
    await auditChallenge(tx, input, challenge.userId, action, true);
    if (credential.mustChangePassword) {
      return {
        status: "password_change" as const,
        token: await issueAuthChallenge(
          tx,
          challenge.userId,
          "PASSWORD_CHANGE",
          now,
        ),
      };
    }
    return {
      status: "success" as const,
      token: await issueSession(tx, challenge.userId, now),
    };
  });
}

interface OwnCredentialCommand extends AuthFlowContext {
  actor: SessionActor;
  currentPassword: string;
}

async function readOwnCredential(
  tx: Prisma.TransactionClient,
  actor: SessionActor,
  now: Date,
) {
  await lockAuthUser(tx, actor.userId);
  await tx.$queryRaw`
    SELECT id FROM sessions WHERE id = ${actor.sessionId}::uuid FOR UPDATE
  `;
  const session = await tx.session.findFirst({
    where: {
      id: actor.sessionId,
      userId: actor.userId,
      revokedAt: null,
      issuedAt: { lte: now },
      expiresAt: { gt: now },
      lastUsedAt: { gt: new Date(now.getTime() - SESSION_IDLE_MS) },
      user: { isActive: true, roleCode: actor.roleCode },
    },
    select: {
      user: {
        select: {
          credential: {
            select: {
              passwordHash: true,
              mustChangePassword: true,
              totpKeyId: true,
            },
          },
        },
      },
    },
  });
  const credential = session?.user.credential;
  return credential && !credential.mustChangePassword ? credential : null;
}

async function allowOwnCredentialAttempt(
  database: PrismaClient,
  input: OwnCredentialCommand,
  now: Date,
) {
  return (
    input.currentPassword.length > 0 &&
    input.currentPassword.length <= 256 &&
    takeAuthAttempt(
      database,
      "credential",
      input.actor.userId,
      input.ipAddress,
      now,
    )
  );
}

export async function changeOwnPassword(
  database: PrismaClient,
  input: OwnCredentialCommand & { newPassword: string },
) {
  const now = input.now ?? new Date();
  const password = newPasswordSchema.safeParse(input.newPassword);
  if (
    !password.success ||
    !(await allowOwnCredentialAttempt(database, input, now))
  ) {
    return null;
  }

  return database.$transaction(async (tx) => {
    const userId = input.actor.userId;
    const action = "auth.password.change";
    const credential = await readOwnCredential(tx, input.actor, now);
    if (!credential) return null;
    const verified = await verify(
      credential.passwordHash,
      input.currentPassword,
    );
    if (!verified || input.currentPassword === password.data) {
      await auditChallenge(tx, input, userId, action, false);
      return null;
    }

    const passwordHash = await hashPassword(password.data);
    await tx.userCredential.update({
      where: { userId },
      data: { passwordHash },
    });
    await revokeAuthenticationState(tx, userId, now);
    await auditChallenge(tx, input, userId, action, true);
    return {
      status: "success" as const,
      token: await issueSession(tx, userId, now),
    };
  });
}

export async function beginOwnTotpEnrollment(
  database: PrismaClient,
  input: OwnCredentialCommand,
) {
  const now = input.now ?? new Date();
  if (!(await allowOwnCredentialAttempt(database, input, now))) return null;

  return database.$transaction(async (tx) => {
    const userId = input.actor.userId;
    const action = "auth.totp.begin-enrollment";
    const credential = await readOwnCredential(tx, input.actor, now);
    if (!credential || credential.totpKeyId) return null;
    if (!(await verify(credential.passwordHash, input.currentPassword))) {
      await auditChallenge(tx, input, userId, action, false);
      return null;
    }
    await auditChallenge(tx, input, userId, action, true);
    return {
      status: "totp_enrollment" as const,
      token: await issueAuthChallenge(tx, userId, "TOTP_ENROLLMENT", now),
    };
  });
}
