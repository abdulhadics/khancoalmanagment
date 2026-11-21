import { randomBytes, randomUUID } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermissionDenied } from "../../src/domain/permissions";
import { makePrisma } from "../../src/server/db/connect";
import { hashPassword } from "../../src/server/auth/password";
import { listStaff, mutateStaff, readStaff } from "../../src/server/auth/staff";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const request = { requestId: randomUUID(), ipAddress: "127.0.0.1" };
let manager: { userId: string; sessionId: string; roleCode: "OWNER" };
let restorePasswordChange: boolean | undefined;

async function saveSession(userId: string) {
  const now = new Date();
  return database.session.create({
    data: {
      userId,
      tokenDigest: randomBytes(32).toString("hex"),
      issuedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    },
  });
}

async function newStaff(roleCode = "OPERATOR") {
  const label = `staff-${randomUUID()}`;
  const password = randomBytes(32).toString("base64url");
  const result = await mutateStaff(database, manager, request, {
    operation: "create",
    displayName: "Dispatch Staff",
    username: label.toUpperCase(),
    email: `${label.toUpperCase()}@EXAMPLE.TEST`,
    roleCode,
    password,
  });
  return { ...result, label, password };
}

beforeAll(async () => {
  const existing = await database.user.findFirst({
    where: { roleCode: "OWNER", isActive: true },
    select: { id: true, credential: { select: { mustChangePassword: true } } },
  });

  let userId: string;
  if (existing?.credential) {
    userId = existing.id;
    restorePasswordChange = existing.credential.mustChangePassword;
    await database.userCredential.update({
      where: { userId },
      data: { mustChangePassword: false },
    });
  } else {
    const label = `manager-${randomUUID()}`;
    const passwordHash = await hashPassword(
      randomBytes(32).toString("base64url"),
    );
    const created = await database.user.create({
      data: {
        displayName: "Staff Manager",
        username: label,
        email: `${label}@example.test`,
        roleCode: "OWNER",
        credential: { create: { passwordHash, mustChangePassword: false } },
      },
      select: { id: true },
    });
    userId = created.id;
  }

  const session = await saveSession(userId);
  manager = { userId, sessionId: session.id, roleCode: "OWNER" };
});

afterAll(async () => {
  try {
    if (manager) {
      await database.session.update({
        where: { id: manager.sessionId },
        data: { revokedAt: new Date() },
      });
      if (restorePasswordChange === undefined) {
        await database.user.update({
          where: { id: manager.userId },
          data: { roleCode: "VIEWER" },
        });
      } else {
        await database.userCredential.update({
          where: { userId: manager.userId },
          data: { mustChangePassword: restorePasswordChange },
        });
      }
    }
  } finally {
    await database.$disconnect();
  }
});

describe("staff administration on PostgreSQL", () => {
  it("normalizes new staff identities, hashes their temporary password, and returns public staff fields", async () => {
    const { staffId, label, password } = await newStaff();
    const staff = await readStaff(database, manager, staffId);
    expect(staff).toEqual({
      id: staffId,
      displayName: "Dispatch Staff",
      username: label,
      email: `${label}@example.test`,
      roleCode: "OPERATOR",
      isActive: true,
      lastLoginAt: null,
    });
    expect(await listStaff(database, manager)).toContainEqual(staff);
    const credential = await database.userCredential.findUniqueOrThrow({
      where: { userId: staffId },
    });
    expect(credential.mustChangePassword).toBe(true);
    expect(await verify(credential.passwordHash, password)).toBe(true);
    await expect(
      mutateStaff(database, manager, request, {
        operation: "create",
        displayName: "Duplicate",
        username: label,
        email: `${randomUUID()}@example.test`,
        roleCode: "VIEWER",
        password,
      }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("rejects unauthorized or stale actors and preserves the last active Owner", async () => {
    const { staffId } = await newStaff();
    const outsider = await saveSession(staffId);
    const deniedCommand = {
      operation: "access",
      userId: manager.userId,
      roleCode: "OPERATOR",
      isActive: false,
    };
    await expect(
      mutateStaff(
        database,
        { userId: staffId, sessionId: outsider.id, roleCode: "OPERATOR" },
        request,
        deniedCommand,
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      mutateStaff(
        database,
        { userId: staffId, sessionId: outsider.id, roleCode: "OWNER" },
        request,
        deniedCommand,
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      readStaff(database, { ...manager, sessionId: randomUUID() }, staffId),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      mutateStaff(database, manager, request, deniedCommand),
    ).rejects.toMatchObject({ code: "lastOwner" });
  });

  it("revokes sessions and challenges when changing access or resetting a password", async () => {
    const { staffId, password } = await newStaff();
    const session = await saveSession(staffId);
    const challenge = await database.authChallenge.create({
      data: {
        userId: staffId,
        purpose: "PASSWORD_RESET",
        tokenDigest: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await mutateStaff(database, manager, request, {
      operation: "access",
      userId: staffId,
      roleCode: "ACCOUNTANT",
      isActive: false,
    });
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: session.id } }))
        .revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      (
        await database.authChallenge.findUniqueOrThrow({
          where: { id: challenge.id },
        })
      ).consumedAt,
    ).toBeInstanceOf(Date);
    expect(await readStaff(database, manager, staffId)).toMatchObject({
      roleCode: "ACCOUNTANT",
      isActive: false,
    });

    const resetPassword = randomBytes(32).toString("base64url");
    await mutateStaff(database, manager, request, {
      operation: "reset",
      userId: staffId,
      password: resetPassword,
    });
    const credential = await database.userCredential.findUniqueOrThrow({
      where: { userId: staffId },
    });
    expect(credential.mustChangePassword).toBe(true);
    expect(await verify(credential.passwordHash, password)).toBe(false);
    expect(await verify(credential.passwordHash, resetPassword)).toBe(true);
    const events = await database.auditLog.findMany({
      where: { actorId: manager.userId, targetId: staffId },
      orderBy: { id: "asc" },
      select: { action: true, before: true, after: true },
    });
    expect(events).toEqual([
      {
        action: "staff.create",
        before: null,
        after: { roleCode: "OPERATOR", isActive: true },
      },
      {
        action: "staff.access",
        before: { roleCode: "OPERATOR", isActive: true },
        after: { roleCode: "ACCOUNTANT", isActive: false },
      },
      { action: "staff.reset", before: null, after: null },
    ]);
  });
});
