import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type CommandInput = {
  actorId: string;
  operation: string;
  key: string;
  requestDigest: string;
  expiresAt: Date;
};

type CommandResult = { resourceIds: string[] };

export class IdempotencyConflictError extends Error {
  constructor() {
    super("This request key has already been used for a different submission.");
    this.name = "IdempotencyConflictError";
  }
}

function canonicalJson(value: Prisma.JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const fields = keys.flatMap((key) => {
      const field = value[key];
      return field === undefined
        ? []
        : [`${JSON.stringify(key)}:${canonicalJson(field)}`];
    });
    return `{${fields.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("The request fingerprint requires finite numbers.");
  }
  return JSON.stringify(value);
}

// Use validated business input with decimal values and business dates as
// canonical strings. Array order contributes to the fingerprint.
export function fingerprintCommand(payload: Prisma.JsonValue) {
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function readResult(response: Prisma.JsonValue): CommandResult {
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    throw new Error("The recorded request has no committed references.");
  }
  const { resourceIds } = response;
  if (
    !Array.isArray(resourceIds) ||
    !resourceIds.every((id) => typeof id === "string")
  ) {
    throw new Error("The recorded request has invalid references.");
  }
  return { resourceIds };
}

// Authorize access before invoking this service and when resolving the
// returned resources. Store references only so retries use current access rules.
export function runIdempotentCommand(
  database: PrismaClient,
  input: CommandInput,
  execute: (tx: Prisma.TransactionClient) => Promise<CommandResult>,
) {
  const { actorId, operation, key, requestDigest, expiresAt } = input;
  const where = { actorId_operation_key: { actorId, operation, key } };

  return database.$transaction(
    async (tx) => {
      // The unique key blocks a simultaneous retry until the first transaction
      // completes. Read Committed lets the next statement see its committed result.
      const claim = await tx.idempotencyKey.createMany({
        data: { actorId, operation, key, requestDigest, expiresAt },
        skipDuplicates: true,
      });
      if (claim.count === 0) {
        const existing = await tx.idempotencyKey.findUniqueOrThrow({
          where,
          select: { requestDigest: true, response: true },
        });
        if (existing.requestDigest !== requestDigest) {
          throw new IdempotencyConflictError();
        }
        return readResult(existing.response);
      }

      const { resourceIds } = await execute(tx);
      const response = { resourceIds };
      await tx.idempotencyKey.update({ where, data: { response } });
      return response;
    },
    { isolationLevel: "ReadCommitted" },
  );
}
