import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { makePrisma } from "../../src/server/db/connect";
import { appendAuditEvent } from "../../src/server/repositories/audit-log";
import {
  fingerprintCommand,
  IdempotencyConflictError,
  runIdempotentCommand,
} from "../../src/server/repositories/idempotency";
import { reserveNumberBlock } from "../../src/server/repositories/number-sequences";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Run the integration suite against an isolated migrated test database.",
  );
}
const database = makePrisma(databaseUrl);
let actorId: string;

beforeAll(async () => {
  const unique = randomUUID().replaceAll("-", "").slice(0, 16);
  const actor = await database.user.create({
    data: {
      username: `fixture_${unique}`,
      email: `fixture-${unique}@example.test`,
      displayName: "Repository Fixture",
      roleCode: "ACCOUNTANT",
    },
    select: { id: true },
  });
  actorId = actor.id;
});

afterAll(async () => {
  await database.$disconnect();
});

function commandInput(payload: { vehicle: string }) {
  return {
    actorId,
    operation: "dispatch.create",
    key: randomUUID(),
    requestDigest: fingerprintCommand(payload),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

describe("transactional counter reservations", () => {
  it("allocates contiguous disjoint blocks across concurrent transactions", async () => {
    const scope = 2041;
    const blocks = await Promise.all(
      [3, 1, 2, 4].map((quantity) =>
        database.$transaction((tx) =>
          reserveNumberBlock(tx, "ORDER", scope, quantity),
        ),
      ),
    );

    const ordinals = blocks
      .flatMap(({ firstOrdinal, quantity }) =>
        Array.from(
          { length: quantity },
          (_, offset) => Number(firstOrdinal) + offset,
        ),
      )
      .sort((left, right) => left - right);
    expect(ordinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(
      database.$transaction((tx) => reserveNumberBlock(tx, "ORDER", scope, 1)),
    ).resolves.toEqual({ firstOrdinal: 11n, quantity: 1 });
  });

  it("returns a reserved block when the caller rolls back", async () => {
    const scope = 2042;
    await expect(
      database.$transaction(async (tx) => {
        const reservation = await reserveNumberBlock(tx, "ORDER", scope, 3);
        expect(reservation.firstOrdinal).toBe(1n);
        throw new Error("Cancel fixture transaction.");
      }),
    ).rejects.toThrow("Cancel fixture transaction.");

    await expect(
      database.$transaction((tx) => reserveNumberBlock(tx, "ORDER", scope, 1)),
    ).resolves.toEqual({ firstOrdinal: 1n, quantity: 1 });
  });
});

describe("idempotent commands", () => {
  it("hashes object key order consistently and preserves order within arrays", () => {
    const ordered = {
      rows: [{ weight: "4.500", amount: "2.00" }, null],
      date: "2026-11-21",
    };
    const reordered = {
      date: "2026-11-21",
      rows: [{ amount: "2.00", weight: "4.500" }, null],
    };
    expect(fingerprintCommand(ordered)).toEqual(fingerprintCommand(reordered));
    expect(fingerprintCommand(ordered)).not.toEqual(
      fingerprintCommand({ ...ordered, rows: [...ordered.rows].reverse() }),
    );
  });

  it("commits an effect once and returns the same references to simultaneous retries", async () => {
    const input = commandInput({ vehicle: "TEST-123" });
    const requestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runIdempotentCommand(database, input, async (tx) => {
          const { id } = await appendAuditEvent(tx, {
            actor: { type: "USER", id: actorId },
            area: "dispatch",
            action: "dispatch.create",
            targetType: "order",
            requestId,
            outcome: "SUCCESS",
          });
          return { resourceIds: [String(id)] };
        }),
      ),
    );

    expect(results).toHaveLength(4);
    expect(
      results.every(
        (result) => result.resourceIds[0] === results[0]?.resourceIds[0],
      ),
    ).toBe(true);
    expect(results[0]?.resourceIds).toHaveLength(1);
    expect(await database.auditLog.count({ where: { requestId } })).toBe(1);
  });

  it("rejects reuse of a key for a different request", async () => {
    const input = commandInput({ vehicle: "TEST-123" });
    const execute = vi.fn(async () => ({ resourceIds: [randomUUID()] }));
    const original = await runIdempotentCommand(database, input, execute);

    await expect(
      runIdempotentCommand(database, input, execute),
    ).resolves.toEqual(original);
    await expect(
      runIdempotentCommand(
        database,
        {
          ...input,
          requestDigest: fingerprintCommand({ vehicle: "TEST-456" }),
        },
        execute,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("releases the claim and number reservation on failure", async () => {
    const input = commandInput({ vehicle: "TEST-123" });
    const scope = 2043;
    const counter = await database.numberSequence.findUnique({
      where: { kind_scope: { kind: "ORDER", scope } },
      select: { nextOrdinal: true },
    });
    const initialOrdinal = counter?.nextOrdinal ?? 1n;
    await expect(
      runIdempotentCommand(database, input, async (tx) => {
        await reserveNumberBlock(tx, "ORDER", scope, 1);
        throw new Error("Reject fixture write.");
      }),
    ).rejects.toThrow("Reject fixture write.");

    const retried = await runIdempotentCommand(database, input, async (tx) => {
      const { firstOrdinal } = await reserveNumberBlock(tx, "ORDER", scope, 1);
      return { resourceIds: [String(firstOrdinal)] };
    });
    expect(retried.resourceIds).toEqual([String(initialOrdinal)]);
  });
});

describe("audit repository", () => {
  it("records safe field changes and drops credential and contact metadata", async () => {
    const requestId = randomUUID();
    const targetId = randomUUID();
    const { id } = await database.$transaction((tx) =>
      appendAuditEvent(tx, {
        actor: { type: "USER", id: actorId },
        area: "identity",
        action: "profile.update",
        targetType: "user",
        targetId,
        requestId,
        ipAddress: "127.0.0.1",
        outcome: "SUCCESS",
        before: {
          isActive: true,
          password_hash: "private",
          email: "private@example.test",
        },
        after: {
          isActive: false,
          resetToken: "private",
          contactPhone: "private",
        },
      }),
    );
    const audit = await database.auditLog.findUniqueOrThrow({ where: { id } });
    expect(audit).toMatchObject({
      actorId,
      actorType: "USER",
      targetId,
      requestId,
      outcome: "SUCCESS",
      before: { isActive: true },
      after: { isActive: false },
    });
    expect(audit.ipAddress?.split("/")[0]).toBe("127.0.0.1");
  });

  it("rolls back a failed write with its audit event", async () => {
    const requestId = randomUUID();
    await expect(
      database.$transaction(async (tx) => {
        await appendAuditEvent(tx, {
          actor: { type: "SYSTEM" },
          area: "administration",
          action: "backup.finished",
          targetType: "backup",
          requestId,
          outcome: "SUCCESS",
        });
        throw new Error("Cancel fixture write.");
      }),
    ).rejects.toThrow("Cancel fixture write.");
    expect(await database.auditLog.count({ where: { requestId } })).toBe(0);
  });

  it("keeps committed audit events append-only", async () => {
    const { id } = await database.$transaction((tx) =>
      appendAuditEvent(tx, {
        actor: { type: "SYSTEM" },
        area: "administration",
        action: "backup.finished",
        targetType: "backup",
        requestId: randomUUID(),
        outcome: "SUCCESS",
      }),
    );
    await expect(
      database.auditLog.update({ where: { id }, data: { outcome: "FAILURE" } }),
    ).rejects.toThrow(/append-only/);
    await expect(database.auditLog.delete({ where: { id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      database.auditLog.findUnique({ where: { id } }),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
    });
  });
});
