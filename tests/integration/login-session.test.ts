import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { RoleCode } from "../../src/generated/prisma/client";
import { loginWithPassword } from "../../src/server/auth/login";
import { hashPassword } from "../../src/server/auth/password";
import {
  getSession,
  revokeAllSessions,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "../../src/server/auth/session";
import { takeAuthAttempt } from "../../src/server/auth/throttle";
import {
  AUTH_CHALLENGE_TTL_MS,
  digestToken,
  isOpaqueToken,
} from "../../src/server/auth/tokens";
import { makePrisma } from "../../src/server/db/connect";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Run the login suite against an isolated migrated test database.",
  );
}

const database = makePrisma(databaseUrl);
const password = `Synthetic fixture ${randomUUID()}`;
const clock = new Date("2026-11-21T10:00:00.000Z");
const minute = 60_000;
const ownerFixtures: string[] = [];

afterAll(async () => {
  try {
    await database.user.updateMany({
      where: { id: { in: ownerFixtures } },
      data: { roleCode: "VIEWER" },
    });
  } finally {
    await database.$disconnect();
  }
});

function login(
  identifier: string,
  submittedPassword = password,
  ip = "192.0.2.20",
) {
  return {
    identifier,
    password: submittedPassword,
    ip,
    requestId: randomUUID(),
  };
}

async function staff(
  roleCode: RoleCode = "ACCOUNTANT",
  mustChangePassword = false,
  isActive = true,
  hasTotp = false,
) {
  const fixture = randomUUID().replaceAll("-", "").slice(0, 16);
  const created = await database.user.create({
    data: {
      username: `fixture_${fixture}`,
      email: `fixture-${fixture}@example.test`,
      displayName: "Login Fixture",
      roleCode,
      isActive,
      credential: {
        create: {
          passwordHash: await hashPassword(password),
          mustChangePassword,
          ...(hasTotp
            ? {
                totpKeyId: "test-factor",
                totpSecretEncrypted: Buffer.from([1, 2, 3]),
              }
            : {}),
        },
      },
    },
  });
  if (roleCode === "OWNER") ownerFixtures.push(created.id);
  return created;
}

describe("password authentication", () => {
  it("accepts normalized username and email and issues new digested sessions", async () => {
    const actor = await staff("ACCOUNTANT");
    const first = await loginWithPassword(
      login(` ${actor.email.toUpperCase()} `),
      database,
      {
        now: clock,
      },
    );
    const second = await loginWithPassword(login(actor.username), database, {
      now: clock,
    });
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status !== "success" || second.status !== "success")
      throw new Error("Fixture login failed.");

    expect(isOpaqueToken(first.token)).toBe(true);
    expect(first.token).not.toBe(second.token);
    const stored = await database.session.findUniqueOrThrow({
      where: { tokenDigest: digestToken(first.token) },
    });
    expect(stored.tokenDigest).not.toBe(first.token);
    expect(stored.expiresAt.getTime() - stored.issuedAt.getTime()).toBe(
      SESSION_ABSOLUTE_MS,
    );
    await expect(getSession(first.token, database, clock)).resolves.toEqual({
      sessionId: stored.id,
      userId: actor.id,
      roleCode: "ACCOUNTANT",
      displayName: actor.displayName,
      username: actor.username,
      email: actor.email,
      locale: "ENGLISH",
    });
    const recorded = await database.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(recorded.lastLoginAt).toEqual(clock);
  });

  it("uses generic failures for unknown, disabled and incorrect credentials", async () => {
    const actor = await staff();
    const disabled = await staff("VIEWER", false, false);
    const attempts = [
      login(`missing-${randomUUID()}@example.test`),
      login(disabled.email),
      login(actor.username, "different test password"),
    ];
    for (const attempt of attempts) {
      await expect(
        loginWithPassword(attempt, database, { now: clock }),
      ).resolves.toEqual({
        status: "invalid",
      });
      const event = await database.auditLog.findFirstOrThrow({
        where: { requestId: attempt.requestId },
        select: { outcome: true, before: true, after: true },
      });
      expect(event).toEqual({ outcome: "FAILURE", before: null, after: null });
    }
  });

  it("requires a first-use password change before mandatory production Owner enrollment", async () => {
    const actor = await staff("OWNER", true);
    const initial = await loginWithPassword(login(actor.username), database, {
      now: clock,
      production: true,
    });
    expect(initial.status).toBe("password_change");
    if (initial.status !== "password_change")
      throw new Error("Fixture challenge was not issued.");
    const challenge = await database.authChallenge.findUniqueOrThrow({
      where: { tokenDigest: digestToken(initial.token) },
    });
    expect(challenge.purpose).toBe("PASSWORD_CHANGE");
    expect(challenge.expiresAt.getTime() - challenge.createdAt.getTime()).toBe(
      AUTH_CHALLENGE_TTL_MS.PASSWORD_CHANGE,
    );
    expect(await getSession(initial.token, database, clock)).toBeNull();

    await database.userCredential.update({
      where: { userId: actor.id },
      data: { mustChangePassword: false },
    });
    const enrollment = await loginWithPassword(
      login(actor.username),
      database,
      { now: clock, production: true },
    );
    expect(enrollment.status).toBe("totp_enrollment");
    expect(await database.session.count({ where: { userId: actor.id } })).toBe(
      0,
    );
    const unlogged = await database.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(unlogged.lastLoginAt).toBeNull();
  });

  it("requires enrolled TOTP on each login and rotates an existing continuation", async () => {
    const actor = await staff("ACCOUNTANT", false, true, true);
    const one = await loginWithPassword(login(actor.email), database, {
      now: clock,
    });
    const two = await loginWithPassword(login(actor.email), database, {
      now: new Date(clock.getTime() + minute),
    });
    expect(one.status).toBe("totp_challenge");
    expect(two.status).toBe("totp_challenge");
    if (one.status !== "totp_challenge" || two.status !== "totp_challenge")
      throw new Error("Fixture challenge was not issued.");
    expect(two.token).not.toBe(one.token);
    const older = await database.authChallenge.findUniqueOrThrow({
      where: { tokenDigest: digestToken(one.token) },
    });
    const latest = await database.authChallenge.findUniqueOrThrow({
      where: { tokenDigest: digestToken(two.token) },
    });
    expect(older.consumedAt).toEqual(new Date(clock.getTime() + minute));
    expect(latest.consumedAt).toBeNull();
    expect(await database.session.count({ where: { userId: actor.id } })).toBe(
      0,
    );
  });

  it("checks an existing second factor before accepting a forced password change", async () => {
    const actor = await staff("ACCOUNTANT", true, true, true);
    await expect(
      loginWithPassword(login(actor.username), database, { now: clock }),
    ).resolves.toMatchObject({ status: "totp_challenge" });
    expect(
      await database.authChallenge.count({
        where: { userId: actor.id, purpose: "PASSWORD_CHANGE" },
      }),
    ).toBe(0);
  });

  it("uses one account throttle for username and email and unlocks at the next window", async () => {
    const actor = await staff();
    const wrong = "different test password";
    for (let index = 0; index < 6; index += 1) {
      const identifier = index % 2 === 0 ? actor.username : actor.email;
      await expect(
        loginWithPassword(login(identifier, wrong), database, { now: clock }),
      ).resolves.toEqual({
        status: "invalid",
      });
    }
    const blocked = login(actor.email);
    await expect(
      loginWithPassword(blocked, database, { now: clock }),
    ).resolves.toEqual({ status: "invalid" });
    expect(
      await database.auditLog.findFirst({
        where: { requestId: blocked.requestId },
        select: { outcome: true },
      }),
    ).toEqual({ outcome: "DENIED" });
    await expect(
      loginWithPassword(login(actor.username), database, {
        now: new Date(clock.getTime() + 15 * minute),
      }),
    ).resolves.toMatchObject({ status: "success" });
  });
});

describe("server-side sessions", () => {
  it("enforces idle and absolute expiry and never revives an expired session", async () => {
    const actor = await staff();
    const idle = await loginWithPassword(login(actor.username), database, {
      now: clock,
    });
    const absolute = await loginWithPassword(login(actor.email), database, {
      now: clock,
    });
    if (idle.status !== "success" || absolute.status !== "success")
      throw new Error("Fixture login failed.");
    expect(await getSession(null, database, clock)).toBeNull();
    expect(await getSession("bad-format", database, clock)).toBeNull();
    const beforeIdle = new Date(clock.getTime() + SESSION_IDLE_MS - minute);
    expect(await getSession(idle.token, database, beforeIdle)).toMatchObject({
      userId: actor.id,
    });
    const afterIdle = new Date(beforeIdle.getTime() + SESSION_IDLE_MS);
    expect(await getSession(idle.token, database, afterIdle)).toBeNull();

    const absoluteBoundary = new Date(clock.getTime() + SESSION_ABSOLUTE_MS);
    await database.session.update({
      where: { tokenDigest: digestToken(absolute.token) },
      data: { lastUsedAt: new Date(absoluteBoundary.getTime() - 2 * minute) },
    });
    expect(
      await getSession(
        absolute.token,
        database,
        new Date(absoluteBoundary.getTime() - minute),
      ),
    ).toMatchObject({ userId: actor.id });
    expect(
      await getSession(absolute.token, database, absoluteBoundary),
    ).toBeNull();
  });

  it("revokes individual and all devices and rejects live sessions of disabled users", async () => {
    const actor = await staff();
    const results = await Promise.all(
      [actor.username, actor.email, actor.username].map((identifier) =>
        loginWithPassword(login(identifier), database, { now: clock }),
      ),
    );
    const [current, other, disabled] = results;
    if (
      current?.status !== "success" ||
      other?.status !== "success" ||
      disabled?.status !== "success"
    ) {
      throw new Error("Fixture login failed.");
    }
    await expect(revokeSession(database, current.token, clock)).resolves.toBe(
      true,
    );
    await expect(revokeSession(database, current.token, clock)).resolves.toBe(
      false,
    );
    expect(await getSession(current.token, database, clock)).toBeNull();
    expect(await getSession(other.token, database, clock)).toMatchObject({
      userId: actor.id,
    });

    await database.user.update({
      where: { id: actor.id },
      data: { isActive: false },
    });
    expect(await getSession(disabled.token, database, clock)).toBeNull();
    await expect(revokeAllSessions(database, actor.id, clock)).resolves.toBe(2);
    await database.user.update({
      where: { id: actor.id },
      data: { isActive: true },
    });
    expect(await getSession(other.token, database, clock)).toBeNull();
  });
});

describe("password recovery throttling", () => {
  it("enforces the identity limit across concurrent attempts and separates window lifetimes", async () => {
    const identity = `fixture-${randomUUID()}@example.test`;
    const ip = "203.0.113.15";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        takeAuthAttempt(database, "reset", identity, ip, clock),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    await expect(
      takeAuthAttempt(database, "login", identity, ip, clock),
    ).resolves.toBe(true);
    await expect(
      takeAuthAttempt(
        database,
        "reset",
        identity,
        ip,
        new Date(clock.getTime() + 60 * minute),
      ),
    ).resolves.toBe(true);
  });
});
