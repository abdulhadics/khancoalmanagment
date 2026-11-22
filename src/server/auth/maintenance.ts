import type { PrismaClient } from "@/generated/prisma/client";

export async function pruneExpiredAuthState(
  database: PrismaClient,
  now = new Date(),
) {
  const where = { expiresAt: { lte: now } };
  const [sessions, challenges, throttleBuckets] = await database.$transaction([
    database.session.deleteMany({ where }),
    database.authChallenge.deleteMany({ where }),
    database.rateLimitBucket.deleteMany({ where }),
  ]);
  return {
    sessions: sessions.count,
    challenges: challenges.count,
    throttleBuckets: throttleBuckets.count,
  };
}
