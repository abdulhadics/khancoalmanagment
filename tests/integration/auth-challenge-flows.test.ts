import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  beginOwnTotpEnrollment,
  changeOwnPassword,
  completeForcedPasswordChange,
  completeTotpChallenge,
  completeTotpEnrollment,
  readTotpSetup,
} from "../../src/server/auth/challenge-flows";
import { loginWithPassword } from "../../src/server/auth/login";
import { pruneExpiredAuthState } from "../../src/server/auth/maintenance";
import { hashPassword } from "../../src/server/auth/password";
import {
  completePasswordReset,
  requestPasswordReset,
} from "../../src/server/auth/recovery";
import { getSession } from "../../src/server/auth/session";
import {
  AUTH_CHALLENGE_TTL_MS,
  digestToken,
} from "../../src/server/auth/tokens";
import { deriveTotpEnrollmentSecret } from "../../src/server/auth/totp";
import { makePrisma } from "../../src/server/db/connect";

function testDatabase() {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (!url) throw new Error("Run with the isolated PostgreSQL test database.");
  return makePrisma(url);
}

function newPassword() {
  return randomBytes(32).toString("base64url");
}

async function createAccount(
  database: ReturnType<typeof testDatabase>,
  password: string,
  mustChangePassword: boolean,
) {
  const username = `flow-${randomUUID()}`;
  return database.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Auth Flow Test",
      roleCode: "ACCOUNTANT",
      credential: {
        create: {
          passwordHash: await hashPassword(password),
          mustChangePassword,
        },
      },
    },
  });
}

function authenticatorCode(secret: Buffer, now: Date) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const hash = createHmac("sha1", secret).update(counter).digest();
  const offset = hash.at(-1)! % 16;
  return ((hash.readUInt32BE(offset) % 2 ** 31) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

describe("authentication challenge completion", () => {
  it("prunes expired authentication records and preserves current credentials", async () => {
    const database = testDatabase();
    const started = new Date("1970-01-01T00:00:00Z");
    const cutoff = new Date("1970-01-01T01:00:00Z");
    const active = new Date("1970-01-01T02:00:00Z");

    try {
      const user = await createAccount(database, newPassword(), false);
      const scope = `cleanup.${randomUUID()}`;
      for (const expiresAt of [cutoff, active]) {
        await database.session.create({
          data: {
            userId: user.id,
            tokenDigest: digestToken(newPassword()),
            issuedAt: started,
            lastUsedAt: started,
            expiresAt,
          },
        });
        await database.authChallenge.create({
          data: {
            userId: user.id,
            purpose: "PASSWORD_RESET",
            tokenDigest: digestToken(newPassword()),
            createdAt: started,
            expiresAt,
          },
        });
        await database.rateLimitBucket.create({
          data: {
            scope,
            identifierDigest: digestToken(newPassword()),
            windowStart: started,
            expiresAt,
          },
        });
      }

      await expect(pruneExpiredAuthState(database, cutoff)).resolves.toEqual({
        sessions: 1,
        challenges: 1,
        throttleBuckets: 1,
      });
      await expect(pruneExpiredAuthState(database, cutoff)).resolves.toEqual({
        sessions: 0,
        challenges: 0,
        throttleBuckets: 0,
      });
      for (const records of [
        await database.session.findMany({ where: { userId: user.id } }),
        await database.authChallenge.findMany({ where: { userId: user.id } }),
        await database.rateLimitBucket.findMany({ where: { scope } }),
      ]) {
        expect(records.map(({ expiresAt }) => expiresAt)).toEqual([active]);
      }
      await expect(
        database.userCredential.count({ where: { userId: user.id } }),
      ).resolves.toBe(1);
    } finally {
      await database.$disconnect();
    }
  });

  it("requires temporary-password replacement, rotates credentials, and verifies authenticator enrollment and replay protection", async () => {
    const database = testDatabase();
    const now = new Date("2026-11-21T08:00:01.000Z");
    const temp = newPassword();
    const changed = newPassword();
    const currentPassword = newPassword();
    const encryptionKey = randomBytes(32);
    const ip = "192.0.2.85";
    const requestId = randomUUID();

    try {
      const user = await createAccount(database, temp, true);
      const login = (password: string, at = now) =>
        loginWithPassword(
          { identifier: user.username, password, ip, requestId },
          database,
          {
            now: at,
            production: true,
          },
        );
      const first = await login(temp);
      expect(first.status).toBe("password_change");
      if (first.status !== "password_change")
        throw new Error("Missing change challenge.");
      const forcedInput = {
        challengeToken: first.token,
        enforceOwnerTotp: true,
        now,
      };
      await expect(
        completeForcedPasswordChange(database, {
          ...forcedInput,
          newPassword: temp,
        }),
      ).resolves.toBeNull();
      const firstSession = await completeForcedPasswordChange(database, {
        ...forcedInput,
        newPassword: changed,
      });
      if (firstSession?.status !== "success")
        throw new Error("Missing changed-password session.");
      await expect(
        completeForcedPasswordChange(database, {
          ...forcedInput,
          newPassword: newPassword(),
        }),
      ).resolves.toBeNull();

      const actor = await getSession(firstSession.token, database, now);
      if (!actor) throw new Error("Missing active session.");
      const rotated = await changeOwnPassword(database, {
        actor,
        currentPassword: changed,
        newPassword: currentPassword,
        now,
      });
      if (!rotated) throw new Error("Missing rotated session.");
      await expect(
        getSession(firstSession.token, database, now),
      ).resolves.toBeNull();
      const rotatedActor = await getSession(rotated.token, database, now);
      if (!rotatedActor) throw new Error("Missing active rotated session.");
      await expect(
        beginOwnTotpEnrollment(database, {
          actor,
          currentPassword,
          now,
        }),
      ).resolves.toBeNull();

      const enrollment = await beginOwnTotpEnrollment(database, {
        actor: rotatedActor,
        currentPassword,
        now,
      });
      if (!enrollment) throw new Error("Missing enrollment challenge.");
      const enrollmentData = await readTotpSetup(
        database,
        enrollment.token,
        encryptionKey,
        now,
      );
      expect(enrollmentData?.secret).toMatch(/^[A-Z2-7]{32}$/);
      const secret = deriveTotpEnrollmentSecret(
        encryptionKey,
        enrollment.token,
      );
      const code = authenticatorCode(secret, now);
      const enrolled = await completeTotpEnrollment(database, {
        challengeToken: enrollment.token,
        code,
        now,
        encryptionKey,
      });
      expect(enrolled?.status).toBe("success");
      await expect(
        getSession(rotated.token, database, now),
      ).resolves.toBeNull();
      await expect(
        readTotpSetup(database, enrollment.token, encryptionKey, now),
      ).resolves.toBeNull();

      const second = await login(currentPassword);
      if (second.status !== "totp_challenge")
        throw new Error("Missing authenticator challenge.");
      await expect(
        completeTotpChallenge(database, {
          challengeToken: second.token,
          code,
          now,
          encryptionKey,
        }),
      ).resolves.toBeNull();
      const nextStep = new Date(now.getTime() + 30_000);
      const verified = await completeTotpChallenge(database, {
        challengeToken: second.token,
        code: authenticatorCode(secret, nextStep),
        now: nextStep,
        encryptionKey,
      });
      expect(verified?.status).toBe("success");

      // A subsequent staff reset still requires the previously enrolled factor.
      await database.userCredential.update({
        where: { userId: user.id },
        data: { mustChangePassword: true },
      });
      const forcedStep = new Date(now.getTime() + 60_000);
      const resetLogin = await login(currentPassword, forcedStep);
      if (resetLogin.status !== "totp_challenge")
        throw new Error("Second factor must precede replacement.");
      const verifiedReset = await completeTotpChallenge(database, {
        challengeToken: resetLogin.token,
        code: authenticatorCode(secret, forcedStep),
        now: forcedStep,
        encryptionKey,
      });
      if (verifiedReset?.status !== "password_change")
        throw new Error("Missing protected change challenge.");
      await expect(
        completeForcedPasswordChange(database, {
          challengeToken: verifiedReset.token,
          newPassword: newPassword(),
          now: forcedStep,
          enforceOwnerTotp: true,
        }),
      ).resolves.toMatchObject({ status: "success" });
    } finally {
      await database.$disconnect();
    }
  });

  it("sends reset mail generically and consumes only one concurrent redemption", async () => {
    const database = testDatabase();
    const currentPassword = newPassword();
    const replacement = newPassword();
    const now = new Date("2026-11-21T08:35:00.000Z");
    const ipAddress = "192.0.2.87";
    const deliveries: { to: string; resetUrl: string }[] = [];
    const origin = "https://coal.example.test";
    const mail = {
      origin,
      sendResetEmail: async (message: { to: string; resetUrl: string }) => {
        await Promise.resolve();
        deliveries.push(message);
      },
    };

    try {
      const user = await createAccount(database, currentPassword, false);
      const originalSession = await loginWithPassword(
        {
          identifier: user.username,
          password: currentPassword,
          requestId: randomUUID(),
        },
        database,
        { now, production: false },
      );
      if (originalSession.status !== "success")
        throw new Error("Missing original session.");

      await expect(
        requestPasswordReset(
          database,
          {
            identifier: "absent@example.test",
            now,
            ipAddress,
          },
          mail,
        ),
      ).resolves.toBeUndefined();
      expect(deliveries).toHaveLength(0);
      await expect(
        requestPasswordReset(
          database,
          {
            identifier: ` ${user.email.toUpperCase()} `,
            now,
            ipAddress,
          },
          mail,
        ),
      ).resolves.toBeUndefined();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].to).toBe(user.email);
      const link = new URL(deliveries[0].resetUrl);
      expect(link.origin + link.pathname).toBe(`${origin}/reset-password`);
      const token = link.searchParams.get("token");
      if (!token) throw new Error("Missing reset token.");
      const challenge = await database.authChallenge.findUniqueOrThrow({
        where: { tokenDigest: digestToken(token) },
      });
      expect(challenge.tokenDigest).not.toBe(token);
      expect(challenge.expiresAt.getTime() - now.getTime()).toBe(
        AUTH_CHALLENGE_TTL_MS.PASSWORD_RESET,
      );

      const reset = { resetToken: token, newPassword: replacement, now };
      const results = await Promise.all([
        completePasswordReset(database, reset),
        completePasswordReset(database, reset),
      ]);
      expect(results.sort()).toEqual([false, true]);
      await expect(
        getSession(originalSession.token, database, now),
      ).resolves.toBeNull();

      await requestPasswordReset(
        database,
        { identifier: user.username, now, ipAddress },
        mail,
      );
      const expiredToken = new URL(deliveries[1].resetUrl).searchParams.get(
        "token",
      );
      if (!expiredToken) throw new Error("Missing second reset token.");
      await expect(
        completePasswordReset(database, {
          resetToken: expiredToken,
          newPassword: newPassword(),
          now: new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS.PASSWORD_RESET),
        }),
      ).resolves.toBe(false);

      await expect(
        requestPasswordReset(
          database,
          { identifier: user.username, now, ipAddress },
          {
            origin,
            sendResetEmail: async () => {
              throw new Error("Simulated transport failure");
            },
          },
        ),
      ).resolves.toBeUndefined();
      const deliveryFailure = await database.auditLog.findFirst({
        where: { action: "auth.password.reset-delivery", targetId: user.id },
        select: { outcome: true, before: true, after: true },
      });
      expect(deliveryFailure).toEqual({
        outcome: "FAILURE",
        before: null,
        after: null,
      });
    } finally {
      await database.$disconnect();
    }
  });
});
