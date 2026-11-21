import type { Permission } from "@/domain/permissions";
import { requirePermission } from "@/domain/permissions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { requireLivePermission } from "@/server/auth/live-principal";
import type { SessionActor } from "@/server/auth/session";
import { takeAuthAttempt } from "@/server/auth/throttle";

export const documentProfileFields = {
  name: true,
  tagline: true,
  address: true,
  phone: true,
  email: true,
  logoBytes: true,
  logoMediaType: true,
  currencySymbol: true,
  weightUnit: true,
  dateFormat: true,
  numberFormat: true,
  footer: true,
} satisfies Prisma.DocumentProfileSelect;

export type DocumentProfile = Prisma.DocumentProfileGetPayload<{
  select: typeof documentProfileFields;
}>;

export type PrintContext = { requestId: string; ipAddress?: string };

export class DocumentPrintThrottled extends Error {
  constructor() {
    super("Print request rate exceeded.");
    this.name = "DocumentPrintThrottled";
  }
}

function isSnapshotConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  const meta = "meta" in error ? error.meta : null;
  return (
    error.code === "P2010" &&
    meta &&
    typeof meta === "object" &&
    "code" in meta &&
    meta.code === "40001"
  );
}

export async function readDocumentForPrint<T>(
  database: PrismaClient,
  actor: SessionActor,
  permission: Permission,
  context: PrintContext,
  now: Date,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  requirePermission(actor, permission);
  if (
    !(await takeAuthAttempt(
      database,
      "export",
      actor.userId,
      context.ipAddress,
      now,
    ))
  ) {
    throw new DocumentPrintThrottled();
  }

  const run = () =>
    database.$transaction(
      async (tx) => {
        await requireLivePermission(tx, actor, permission, now);
        return read(tx);
      },
      { isolationLevel: "RepeatableRead" },
    );
  try {
    return await run();
  } catch (error) {
    // A concurrent session touch can precede the row lock on a new snapshot.
    if (!isSnapshotConflict(error)) throw error;
    return run();
  }
}
