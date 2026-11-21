import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PermissionDenied } from "../../src/domain/permissions";
import type { LivePrincipal } from "../../src/server/auth/live-principal";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";
import {
  mutateBank,
  readCompanySettings,
  readWorkspaceDate,
  updateCompanySettings,
} from "../../src/server/settings/company";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
const context = { requestId: randomUUID(), ipAddress: "192.0.2.112" };
let owner: LivePrincipal;
let accountant: LivePrincipal;

async function authenticate(
  roleCode: LivePrincipal["roleCode"],
): Promise<LivePrincipal> {
  const username = `settings-${randomUUID()}`;
  const user = await database.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      displayName: "Settings Test Staff",
      roleCode,
      credential: {
        create: {
          passwordHash: await hashPassword(
            randomBytes(32).toString("base64url"),
          ),
          mustChangePassword: false,
        },
      },
    },
  });
  const now = new Date();
  const session = await database.session.create({
    data: {
      userId: user.id,
      tokenDigest: randomBytes(32).toString("hex"),
      issuedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    },
  });
  return { sessionId: session.id, userId: user.id, roleCode };
}

beforeAll(async () => {
  owner = await authenticate("OWNER");
  accountant = await authenticate("ACCOUNTANT");
});

afterAll(async () => {
  try {
    if (owner) {
      await database.user.update({
        where: { id: owner.userId },
        data: { roleCode: "VIEWER" },
      });
    }
  } finally {
    await database.$disconnect();
  }
});

describe("company settings on PostgreSQL", () => {
  it("writes document revisions, refreshes display settings, and rejects stale saves", async () => {
    const { company: before } = await readCompanySettings(database, owner);
    const profile = before.documentProfile;
    const base = {
      version: before.updatedAt.toISOString(),
      name: profile.name,
      tagline: profile.tagline ?? "",
      address: profile.address ?? "",
      phone: profile.phone ?? "",
      email: profile.email ?? "",
      currencySymbol: profile.currencySymbol,
      weightUnit: profile.weightUnit,
      dateFormat: profile.dateFormat,
      numberFormat: profile.numberFormat,
      footer: profile.footer ?? "",
      orderPrefix: before.orderPrefix,
      voucherPrefix: before.voucherPrefix,
      logo: "keep",
    };
    let updatedVersion: string | undefined;

    try {
      const change = {
        ...base,
        currencySymbol: "PKR",
        dateFormat: "yyyy-MM-dd",
        orderPrefix: "truck1",
      };
      await expect(
        updateCompanySettings(database, accountant, context, change),
      ).rejects.toBeInstanceOf(PermissionDenied);
      await expect(
        updateCompanySettings(
          database,
          { ...accountant, roleCode: "OWNER" },
          context,
          change,
        ),
      ).rejects.toBeInstanceOf(PermissionDenied);

      const result = await updateCompanySettings(
        database,
        owner,
        context,
        change,
      );
      expect(result.documentProfile.id).not.toBe(profile.id);
      expect(result.documentProfile.currencySymbol).toBe("PKR");
      expect(result.orderPrefix).toBe("TRUCK1");
      updatedVersion = result.updatedAt.toISOString();
      expect(
        await database.documentProfile.findUnique({
          where: { id: profile.id },
        }),
      ).toMatchObject({ currencySymbol: profile.currencySymbol });
      await expect(
        readWorkspaceDate(database, new Date("2026-11-20T19:00:00Z")),
      ).resolves.toBe("2026-11-21");
      await expect(
        updateCompanySettings(database, owner, context, change),
      ).rejects.toMatchObject({ code: "stale" });

      const prefixes = await updateCompanySettings(database, owner, context, {
        ...change,
        version: updatedVersion,
        voucherPrefix: "pmt",
      });
      updatedVersion = prefixes.updatedAt.toISOString();
      expect(prefixes.documentProfile.id).toBe(result.documentProfile.id);
      expect(prefixes.voucherPrefix).toBe("PMT");
      expect(
        await database.auditLog.findMany({
          where: { actorId: owner.userId, targetType: "company_settings" },
        }),
      ).toHaveLength(2);
    } finally {
      if (updatedVersion) {
        await updateCompanySettings(database, owner, context, {
          ...base,
          version: updatedVersion,
        });
      }
    }
  });

  it("audits bank create, rename, deactivate, and reactivate and guards permission", async () => {
    const name = ` Bank   ${randomUUID()} `;
    await expect(
      mutateBank(database, accountant, context, {
        operation: "create",
        name,
        category: "BANK",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const first = await mutateBank(database, owner, context, {
      operation: "create",
      name,
      category: "BANK",
    });
    expect(first.name).toBe(name.trim().replace(/\s+/g, " "));
    await expect(
      mutateBank(database, owner, context, {
        operation: "create",
        name: name.toUpperCase(),
        category: "BANK",
      }),
    ).rejects.toMatchObject({ code: "duplicateBank" });

    const edited = await mutateBank(database, owner, context, {
      operation: "edit",
      id: first.id,
      version: first.updatedAt.toISOString(),
      name: `${first.name} branch`,
      category: "BANK",
    });
    expect(edited.name).toMatch(/ branch$/);
    const statusChange = {
      operation: "status",
      id: first.id,
      version: edited.updatedAt.toISOString(),
      isActive: false,
    };
    const inactive = await mutateBank(database, owner, context, statusChange);
    expect(inactive.isActive).toBe(false);
    await expect(
      mutateBank(database, owner, context, statusChange),
    ).rejects.toMatchObject({ code: "stale" });
    const active = await mutateBank(database, owner, context, {
      ...statusChange,
      version: inactive.updatedAt.toISOString(),
      isActive: true,
    });
    expect(active.isActive).toBe(true);
    expect(
      await database.auditLog.findMany({
        where: {
          actorId: owner.userId,
          targetType: "bank",
          targetId: active.id,
        },
        select: { action: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual([
      { action: "bank.create" },
      { action: "bank.edit" },
      { action: "bank.status" },
      { action: "bank.status" },
    ]);
  });
});
