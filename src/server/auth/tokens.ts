import { createHash, randomBytes } from "node:crypto";

import type {
  AuthChallengePurpose,
  Prisma,
} from "../../generated/prisma/client";

const minute = 60_000;

export const AUTH_CHALLENGE_TTL_MS = {
  PASSWORD_RESET: 20 * minute,
  PASSWORD_CHANGE: 10 * minute,
  TOTP_CHALLENGE: 10 * minute,
  TOTP_ENROLLMENT: 10 * minute,
} as const satisfies Record<AuthChallengePurpose, number>;

export function generateOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function isOpaqueToken(
  token: string | null | undefined,
): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function digestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function lockAuthUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

// The caller holds the user lock while issuing or consuming challenges.
export async function issueAuthChallenge(
  tx: Prisma.TransactionClient,
  userId: string,
  purpose: AuthChallengePurpose,
  now = new Date(),
) {
  const token = generateOpaqueToken();
  await tx.authChallenge.updateMany({
    where: {
      userId,
      purpose,
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { lte: now },
    },
    data: { consumedAt: now },
  });
  await tx.authChallenge.create({
    data: {
      userId,
      purpose,
      tokenDigest: digestToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS[purpose]),
    },
    select: { id: true },
  });
  return token;
}
