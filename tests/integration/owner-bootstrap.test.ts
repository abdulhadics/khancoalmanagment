import { randomBytes, randomUUID } from "node:crypto";

import { verify } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";

import {
  readOwnerBootstrapInput,
  seedFirstOwner,
} from "../../src/server/auth/seed-first-owner";
import { makePrisma } from "../../src/server/db/connect";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

function createInput() {
  const identity = randomUUID();
  return readOwnerBootstrapInput({
    OWNER_EMAIL: `owner-${identity}@example.test`,
    OWNER_USERNAME: `owner-${identity}`,
    OWNER_DISPLAY_NAME: "Bootstrap Test Owner",
    OWNER_PASSWORD: randomBytes(32).toString("base64url"),
  });
}

describe("first Owner bootstrap on PostgreSQL", () => {
  it("creates one Owner and a hashed, forced-change credential under contention", async () => {
    if (!databaseUrl) {
      throw new Error("Run the integration suite with its isolated database.");
    }
    const database = makePrisma(databaseUrl);
    const first = createInput();

    try {
      const outcomes = await Promise.all([
        seedFirstOwner(database, first),
        seedFirstOwner(database, first),
      ]);
      expect(outcomes.sort()).toEqual(["already-present", "created"]);

      const owners = await database.user.findMany({
        where: { roleCode: "OWNER" },
      });
      expect(owners).toHaveLength(1);
      expect(owners[0]).toMatchObject({
        email: first.email,
        username: first.username,
        isActive: true,
      });

      const credential = await database.userCredential.findUniqueOrThrow({
        where: { userId: owners[0].id },
      });
      expect(credential.mustChangePassword).toBe(true);
      expect(credential.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(credential.passwordHash, first.password)).toBe(true);

      await expect(seedFirstOwner(database, createInput())).rejects.toThrow(
        "The first Owner already exists.",
      );
      await expect(
        seedFirstOwner(database, {
          ...first,
          password: createInput().password,
        }),
      ).resolves.toBe("already-present");
      expect(
        await database.userCredential.findUniqueOrThrow({
          where: { userId: owners[0].id },
          select: { passwordHash: true },
        }),
      ).toEqual({ passwordHash: credential.passwordHash });

      const audit = await database.auditLog.findMany({
        where: { action: "owner.bootstrap", targetId: owners[0].id },
        select: { actorType: true, outcome: true, after: true },
      });
      expect(audit).toEqual([
        {
          actorType: "SYSTEM",
          outcome: "SUCCESS",
          after: { roleCode: "OWNER", isActive: true },
        },
      ]);
    } finally {
      await database.$disconnect();
    }
  });
});
