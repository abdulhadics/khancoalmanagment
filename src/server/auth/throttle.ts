import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { readEnvironment } from "../config/env";

const policies = {
  login: { windowMs: 15 * 60_000, identityLimit: 6, ipLimit: 60 },
  reset: { windowMs: 60 * 60_000, identityLimit: 3, ipLimit: 30 },
  credential: { windowMs: 15 * 60_000, identityLimit: 6, ipLimit: 60 },
  export: { windowMs: 5 * 60_000, identityLimit: 50, ipLimit: 300 },
} as const;

function makeRateLimitKey() {
  const { AUTH_ENCRYPTION_KEY } = readEnvironment();
  return AUTH_ENCRYPTION_KEY
    ? createHmac("sha256", AUTH_ENCRYPTION_KEY)
        .update("khancoal-auth-throttle-v1")
        .digest()
    : null;
}

function throttleDigest(key: Buffer | null, scope: string, identifier: string) {
  const hash = key ? createHmac("sha256", key) : createHash("sha256");
  return hash.update(scope).update("\0").update(identifier).digest("hex");
}

async function takeSlot(
  tx: Prisma.TransactionClient,
  scope: string,
  digest: string,
  limit: number,
  windowStart: Date,
  expiresAt: Date,
) {
  const [bucket] = await tx.$queryRaw<{ attempts: number }[]>`
    INSERT INTO rate_limit_buckets AS bucket
      (scope, identifier_digest, window_start, expires_at, attempt_count)
    VALUES (${scope}, ${digest}, ${windowStart}, ${expiresAt}, 1)
    ON CONFLICT (scope, identifier_digest, window_start) DO UPDATE
    SET attempt_count = LEAST(bucket.attempt_count + 1, ${limit + 1}::integer)
    RETURNING attempt_count AS attempts
  `;
  return bucket !== undefined && bucket.attempts <= limit;
}

export async function takeAuthAttempt(
  database: PrismaClient,
  action: keyof typeof policies,
  identifier: string,
  ip?: string | null,
  now = new Date(),
) {
  const policy = policies[action];
  const start = Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
  const windowStart = new Date(start);
  const expiresAt = new Date(start + policy.windowMs);
  const source = ip && isIP(ip) ? ip.toLowerCase() : "unknown-source";
  const key = makeRateLimitKey();
  const ipScope = `${action}.ip`;
  const identityScope = `${action}.identity`;

  return database.$transaction(async (tx) => {
    const sourceAllowed = await takeSlot(
      tx,
      ipScope,
      throttleDigest(key, ipScope, source),
      policy.ipLimit,
      windowStart,
      expiresAt,
    );
    // Denied addresses cannot keep creating buckets for new identifiers.
    if (!sourceAllowed) return false;
    return takeSlot(
      tx,
      identityScope,
      throttleDigest(key, identityScope, identifier),
      policy.identityLimit,
      windowStart,
      expiresAt,
    );
  });
}
