import { isIP } from "node:net";

import type {
  AuditActorType,
  AuditOutcome,
  Prisma,
} from "../../generated/prisma/client";

type AuditSnapshot = Readonly<Record<string, string | number | boolean | null>>;

export type AuditEvent = {
  actor:
    { type: "USER"; id: string } | { type: Exclude<AuditActorType, "USER"> };
  area: string;
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  ipAddress?: string;
  outcome: AuditOutcome;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
};

const privateField =
  /password|credential|secret|token|cookie|authorization|hash|digest|keymaterial|recovery|email|phone|address|notes|contactperson/i;

function safeSnapshot(snapshot: AuditSnapshot | undefined) {
  if (!snapshot) return undefined;

  return Object.fromEntries(
    Object.entries(snapshot).filter(
      ([field]) => !privateField.test(field.replaceAll(/[^a-z]/gi, "")),
    ),
  );
}

// Construct snapshots from the affected record's approved fields before calling
// this repository. Keep a mutating action and its audit entry in the same tx.
export async function appendAuditEvent(
  tx: Prisma.TransactionClient,
  event: AuditEvent,
) {
  if (event.ipAddress && !isIP(event.ipAddress)) {
    throw new TypeError("Audit event requires a valid source IP address.");
  }

  return tx.auditLog.create({
    data: {
      actorId: event.actor.type === "USER" ? event.actor.id : undefined,
      actorType: event.actor.type,
      area: event.area,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      outcome: event.outcome,
      before: safeSnapshot(event.before),
      after: safeSnapshot(event.after),
    },
    select: { id: true },
  });
}
