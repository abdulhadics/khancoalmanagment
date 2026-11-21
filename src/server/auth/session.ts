import type {
  LocaleCode,
  Prisma,
  PrismaClient,
  RoleCode,
} from "../../generated/prisma/client";
import { readEnvironment } from "../config/env";
import { getDatabase } from "../db/client";
import { digestToken, generateOpaqueToken, isOpaqueToken } from "./tokens";

export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;

export type SessionActor = {
  sessionId: string;
  userId: string;
  roleCode: RoleCode;
  displayName: string;
  username: string;
  email: string;
  locale: LocaleCode;
};

// Called after the user's password and applicable second factor are verified,
// with the user row locked for the duration of the issuing transaction.
export async function issueSession(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
) {
  const token = generateOpaqueToken();
  await tx.user.update({
    where: {
      id: userId,
      isActive: true,
      credential: { is: { mustChangePassword: false } },
    },
    data: { lastLoginAt: now },
    select: { id: true },
  });
  await tx.session.create({
    data: {
      userId,
      tokenDigest: digestToken(token),
      issuedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    },
    select: { id: true },
  });
  return token;
}

export async function getSession(
  token: string | null | undefined,
  database?: PrismaClient,
  now = new Date(),
): Promise<SessionActor | null> {
  if (!isOpaqueToken(token)) return null;
  const db = database ?? getDatabase();
  const production = readEnvironment().DEPLOYMENT_ENV === "production";
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS);

  const [actor] = await db.$queryRaw<SessionActor[]>`
    UPDATE sessions AS current_session
    SET last_used_at = GREATEST(current_session.last_used_at, ${now})
    FROM users AS staff
    JOIN user_credentials AS credential ON credential.user_id = staff.id
    WHERE current_session.user_id = staff.id
      AND current_session.token_digest = ${digestToken(token)}
      AND current_session.revoked_at IS NULL
      AND current_session.issued_at <= ${now}
      AND current_session.expires_at > ${now}
      AND current_session.last_used_at > ${idleCutoff}
      AND staff.is_active
      AND NOT credential.must_change_password
      AND (NOT ${production}::boolean OR staff.role_code <> 'OWNER' OR credential.totp_key_id IS NOT NULL)
    RETURNING
      current_session.id AS "sessionId",
      staff.id AS "userId",
      staff.role_code::text AS "roleCode",
      staff.display_name AS "displayName",
      staff.username,
      staff.email,
      staff.locale::text AS locale
  `;
  return actor ?? null;
}

export async function revokeSession(
  tx: Prisma.TransactionClient,
  token: string | null | undefined,
  now = new Date(),
) {
  if (!isOpaqueToken(token)) return false;
  const updated = await tx.$executeRaw`
    UPDATE sessions
    SET revoked_at = GREATEST(issued_at, ${now})
    WHERE token_digest = ${digestToken(token)} AND revoked_at IS NULL
  `;
  return updated === 1;
}

export function revokeAllSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
) {
  return tx.$executeRaw`
    UPDATE sessions
    SET revoked_at = GREATEST(issued_at, ${now})
    WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
  `;
}
