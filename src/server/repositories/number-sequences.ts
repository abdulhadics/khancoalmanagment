import type { NumberSequenceKind, Prisma } from "../../generated/prisma/client";

export async function reserveNumberBlock(
  tx: Prisma.TransactionClient,
  kind: NumberSequenceKind,
  scope: number,
  quantity: number,
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError(
      "The number block must contain a positive whole number of entries.",
    );
  }
  if (kind === "ORDER") {
    if (!Number.isInteger(scope) || scope < 1 || scope > 9999) {
      throw new RangeError("The order sequence scope must be a business year.");
    }
  } else if (scope !== 0) {
    throw new RangeError("The voucher and party sequences use scope zero.");
  }

  const increment = BigInt(quantity);
  // PostgreSQL serializes each counter row and releases its lock on commit or
  // rollback. A reservation rolls back together with the records that use it.
  const [row] = await tx.$queryRaw<{ firstOrdinal: bigint }[]>`
    INSERT INTO number_sequences AS counter (kind, scope, next_ordinal)
    VALUES (${kind}::number_sequence_kind, ${scope}::integer, 1 + ${increment}::bigint)
    ON CONFLICT (kind, scope) DO UPDATE
    SET next_ordinal = counter.next_ordinal + ${increment}::bigint
    RETURNING next_ordinal - ${increment}::bigint AS "firstOrdinal"
  `;

  if (!row)
    throw new Error("The number sequence did not return a reserved block.");
  return { firstOrdinal: row.firstOrdinal, quantity };
}
