import { z } from "zod";
import { requirePermission } from "@/domain/permissions";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { AuditOutcome, type AuditActorType } from "@/generated/prisma/enums";
import {
  requireLivePermission,
  type LivePrincipal,
} from "@/server/auth/live-principal";
import { safeAuditSnapshot } from "@/server/repositories/audit-log";

const permission = "admin.audit";
const pageSize = 25;
const optionalDate = z
  .string()
  .regex(/^[1-9]\d{3}-/)
  .pipe(z.iso.date());
const cursorSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");
const auditFilters = z
  .object({
    actor: z.union([z.uuid(), z.enum(["SYSTEM", "ANONYMOUS"])]).optional(),
    action: z.string().trim().max(120).optional(),
    outcome: z.enum(AuditOutcome).optional(),
    from: optionalDate.optional(),
    to: optionalDate.optional(),
    before: cursorSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { path: ["to"] });

type AuditQuery = Record<string, string | string[] | undefined>;
export function parseAuditFilters(query: AuditQuery) {
  function value(name: string) {
    const entry = query[name];
    return typeof entry === "string" ? entry.trim() || undefined : entry;
  }
  return auditFilters.safeParse({
    actor: value("actor"),
    action: value("action"),
    outcome: value("outcome"),
    from: value("from"),
    to: value("to"),
    before: value("before"),
  });
}

type AuditFilter = z.infer<typeof auditFilters>;
type AuditRow = {
  id: bigint;
  actorType: AuditActorType;
  actorName: string | null;
  actorUsername: string | null;
  area: string;
  action: string;
  targetType: string;
  targetId: string | null;
  occurredAt: Date;
  ipAddress: string | null;
  requestId: string;
  outcome: AuditOutcome;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
};

export async function readAuditTimeline(
  database: PrismaClient,
  actor: LivePrincipal,
  { actor: selectedActor, action, outcome, from, to, before }: AuditFilter,
) {
  requirePermission(actor, permission);
  return database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    const conditions = [
      selectedActor === "SYSTEM" || selectedActor === "ANONYMOUS"
        ? Prisma.sql`event.actor_type = ${selectedActor}::audit_actor_type`
        : selectedActor && Prisma.sql`event.actor_id = ${selectedActor}::uuid`,
      action && Prisma.sql`event.action = ${action}`,
      outcome && Prisma.sql`event.outcome = ${outcome}::audit_outcome`,
      from &&
        Prisma.sql`event.occurred_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Karachi')`,
      to &&
        Prisma.sql`event.occurred_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')`,
      before &&
        Prisma.sql`(event.occurred_at, event.id) <
        (SELECT occurred_at, id FROM audit_logs WHERE id = ${BigInt(before)})`,
    ].filter((condition): condition is Prisma.Sql => Boolean(condition));
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.empty;
    const [rows, people] = await Promise.all([
      tx.$queryRaw<AuditRow[]>(Prisma.sql`
        SELECT event.id, event.actor_type AS "actorType", staff.display_name AS "actorName",
          staff.username AS "actorUsername", event.area, event.action,
          event.target_type AS "targetType", event.target_id AS "targetId",
          event.occurred_at AS "occurredAt", host(event.ip_address) AS "ipAddress",
          event.request_id AS "requestId", event.outcome, event.before, event.after
        FROM audit_logs AS event LEFT JOIN users AS staff ON staff.id = event.actor_id
        ${where}
        ORDER BY event.occurred_at DESC, event.id DESC LIMIT ${pageSize + 1}
      `),
      tx.user.findMany({
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        select: { id: true, displayName: true, username: true },
      }),
    ]);

    return {
      people,
      older: rows.length > pageSize ? rows[pageSize - 1].id.toString() : null,
      events: rows.slice(0, pageSize).map((entry) => ({
        ...entry,
        id: entry.id.toString(),
        before: safeAuditSnapshot(entry.before),
        after: safeAuditSnapshot(entry.after),
      })),
    };
  });
}
