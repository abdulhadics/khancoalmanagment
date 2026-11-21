import { randomUUID } from "node:crypto";

import { verify } from "@node-rs/argon2";
import nodemailer from "nodemailer";

import type { PrismaClient } from "../../generated/prisma/client";
import { recoveryEmail } from "../../i18n/messages/recovery-en";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  lockChallenge,
  revokeAuthenticationState,
  type AuthFlowContext,
} from "./challenge-flows";
import { hashPassword, newPasswordSchema } from "./password";
import { takeAuthAttempt } from "./throttle";
import {
  AUTH_CHALLENGE_TTL_MS,
  issueAuthChallenge,
  lockAuthUser,
} from "./tokens";

interface ResetEmail {
  to: string;
  resetUrl: string;
}

type SendResetEmail = (message: ResetEmail) => Promise<void>;

export function makeSmtpResetSender({
  smtpUrl,
  from,
}: {
  smtpUrl: string;
  from: string;
}): SendResetEmail {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure,
    auth: url.username
      ? {
          user: decodeURIComponent(url.username),
          pass: decodeURIComponent(url.password),
        }
      : undefined,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
    logger: false,
    debug: false,
  });

  return async ({ to, resetUrl }) => {
    await transport.sendMail({
      from,
      to,
      subject: recoveryEmail.subject,
      text: recoveryEmail.text(
        resetUrl,
        AUTH_CHALLENGE_TTL_MS.PASSWORD_RESET / 60_000,
      ),
    });
  };
}

export async function requestPasswordReset(
  database: PrismaClient,
  input: AuthFlowContext & { identifier: string },
  options: { origin: string; sendResetEmail: SendResetEmail },
): Promise<void> {
  const now = input.now ?? new Date();
  const requestId = input.requestId ?? randomUUID();
  const identifier =
    input.identifier.length <= 512 ? input.identifier.trim().toLowerCase() : "";
  const lookup = identifier.includes("@")
    ? { email: identifier }
    : { username: identifier };
  const candidate =
    identifier.length > 0 && identifier.length <= 254
      ? await database.user.findUnique({ where: lookup, select: { id: true } })
      : null;
  const allowed = await takeAuthAttempt(
    database,
    "reset",
    candidate?.id ?? identifier,
    input.ipAddress,
    now,
  );
  if (!allowed || !candidate) return;

  const issued = await database.$transaction(async (tx) => {
    await lockAuthUser(tx, candidate.id);
    const current = await tx.user.findUnique({
      where: {
        id: candidate.id,
        ...lookup,
        isActive: true,
        credential: { isNot: null },
      },
      select: { email: true },
    });
    if (!current) return null;
    const token = await issueAuthChallenge(
      tx,
      candidate.id,
      "PASSWORD_RESET",
      now,
    );
    await appendAuditEvent(tx, {
      actor: { type: "ANONYMOUS" },
      area: "identity",
      action: "auth.password.reset-request",
      targetType: "user",
      targetId: candidate.id,
      requestId,
      ipAddress: input.ipAddress,
      outcome: "SUCCESS",
    });
    return { token, email: current.email };
  });
  if (!issued) return;

  const resetUrl = new URL("/reset-password", options.origin);
  resetUrl.searchParams.set("token", issued.token);
  try {
    await options.sendResetEmail({
      to: issued.email,
      resetUrl: resetUrl.toString(),
    });
  } catch {
    // Transport exceptions may include addresses and message contents.
    await appendAuditEvent(database, {
      actor: { type: "SYSTEM" },
      area: "identity",
      action: "auth.password.reset-delivery",
      targetType: "user",
      targetId: candidate.id,
      requestId,
      outcome: "FAILURE",
    });
  }
}

export async function completePasswordReset(
  database: PrismaClient,
  input: AuthFlowContext & { resetToken: string; newPassword: string },
): Promise<boolean> {
  const password = newPasswordSchema.safeParse(input.newPassword);
  if (!password.success) return false;
  const now = input.now ?? new Date();

  return database.$transaction(async (tx) => {
    const challenge = await lockChallenge(
      tx,
      input.resetToken,
      "PASSWORD_RESET",
      now,
    );
    const credential = challenge?.user.credential;
    if (!challenge || !credential) return false;
    if (await verify(credential.passwordHash, password.data)) return false;

    await tx.userCredential.update({
      where: { userId: challenge.userId },
      data: {
        passwordHash: await hashPassword(password.data),
        mustChangePassword: false,
      },
    });
    await revokeAuthenticationState(tx, challenge.userId, now);
    await appendAuditEvent(tx, {
      actor: { type: "USER", id: challenge.userId },
      area: "identity",
      action: "auth.password.reset",
      targetType: "user",
      targetId: challenge.userId,
      requestId: input.requestId ?? randomUUID(),
      ipAddress: input.ipAddress,
      outcome: "SUCCESS",
    });
    return true;
  });
}
