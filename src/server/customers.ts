import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { parseMoney } from "@/domain/money";
import { can, requirePermission } from "@/domain/permissions";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { requireLivePermission } from "./auth/live-principal";
import type { SessionActor } from "./auth/session";
import { appendAuditEvent } from "./repositories/audit-log";
import {
  fingerprintCommand,
  runIdempotentCommand,
} from "./repositories/idempotency";
import { reserveNumberBlock } from "./repositories/number-sequences";
import {
  getPartyRollups,
  getPartyRollupTotals,
} from "./repositories/party-ledger-rollups";
import { lockOpenBusinessMonths } from "./repositories/periods";
import { readDocumentDisplayPreferences } from "./settings/company";

type Actor = Pick<SessionActor, "userId" | "roleCode" | "sessionId">;
type AuditContext = { requestId: string; ipAddress?: string };

export class CustomerError extends Error {
  constructor(
    readonly code: "invalid" | "missing" | "stale" | "openingExists",
    readonly fields: string[] = [],
  ) {
    super(code);
    this.name = "CustomerError";
  }
}

const optionalText = (length: number) =>
  z.string().trim().max(length).default("");

const fieldsSchema = z.object({
  requestKey: z.uuid(),
  name: z.string().trim().min(1).max(160),
  industry: optionalText(120),
  contactPerson: optionalText(120),
  phone: optionalText(12).refine(
    (phone) => !phone || /^03\d{2}-?\d{7}$/.test(phone),
  ),
  email: optionalText(254).refine(
    (email) => !email || z.email().safeParse(email).success,
  ),
  city: optionalText(120),
  address: optionalText(500),
  notes: optionalText(1500),
  creditLimit: optionalText(64),
  isActive: z.boolean().default(true),
  openingAmount: optionalText(64),
  openingDate: optionalText(10),
});

const editSchema = fieldsSchema.extend({
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

function readFields<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CustomerError(
      "invalid",
      result.error.issues.map(({ path }) => String(path[0])),
    );
  }
  return result.data;
}

function readMoney(text: string, field: string, allowZero: boolean) {
  if (!text) return null;
  try {
    const value = parseMoney(text);
    if (value.isNegative() || (!allowZero && value.isZero()))
      throw new RangeError();
    return value.toFixed(2);
  } catch {
    throw new CustomerError("invalid", [field]);
  }
}

function customerData(fields: z.infer<typeof fieldsSchema>) {
  const phone = fields.phone.replace("-", "");
  return {
    name: fields.name,
    nameKey: Array.from(fields.name.toLowerCase()).slice(0, 160).join(""),
    industry: fields.industry || null,
    contactPerson: fields.contactPerson || null,
    phone: phone ? `${phone.slice(0, 4)}-${phone.slice(4)}` : null,
    email: fields.email.toLowerCase() || null,
    city: fields.city || null,
    address: fields.address || null,
    notes: fields.notes || null,
    creditLimit: readMoney(fields.creditLimit, "creditLimit", true),
    isActive: fields.isActive,
  };
}

function readOpening(actor: Actor, fields: z.infer<typeof fieldsSchema>) {
  if (!fields.openingAmount) return null;
  requirePermission(actor, "parties.openingBalance");
  const amount = readMoney(fields.openingAmount, "openingAmount", false)!;
  try {
    const date = parseBusinessDate(fields.openingDate);
    if (fields.openingDate > todayBusinessDate()) throw new RangeError();
    return { date, amount };
  } catch {
    throw new CustomerError("invalid", ["openingDate"]);
  }
}

type Opening = NonNullable<ReturnType<typeof readOpening>>;

async function addOpening(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  opening: Opening,
) {
  await tx.ledgerEntry.create({
    data: {
      kind: "CUSTOMER_OPENING",
      businessDate: opening.date,
      customerId: id,
      amount: opening.amount,
      actorId: actor.userId,
    },
    select: { id: true },
  });
}

function openingSnapshot(opening: Opening | null): Record<string, string> {
  return opening
    ? {
        openingAmount: opening.amount,
        openingDate: opening.date.toISOString().slice(0, 10),
      }
    : {};
}

function customerEvent(actor: Actor, context: AuditContext, id: string) {
  return {
    actor: { type: "USER", id: actor.userId },
    area: "customers",
    targetType: "customer",
    targetId: id,
    outcome: "SUCCESS",
    ...context,
  } as const;
}

const idempotencyHorizonMs = 30 * 24 * 60 * 60_000;

export async function createCustomer(
  database: PrismaClient,
  actor: Actor,
  context: AuditContext,
  raw: unknown,
) {
  requirePermission(actor, "parties.manage");
  const fields = readFields(fieldsSchema, raw);
  const data = customerData(fields);
  const opening = readOpening(actor, fields);

  const result = await runIdempotentCommand(
    database,
    {
      actorId: actor.userId,
      operation: "customers.create",
      key: fields.requestKey,
      requestDigest: fingerprintCommand({
        ...data,
        ...openingSnapshot(opening),
      }),
      expiresAt: new Date(Date.now() + idempotencyHorizonMs),
    },
    async (tx) => {
      if (opening) await lockOpenBusinessMonths(tx, [opening.date]);
      const { firstOrdinal } = await reserveNumberBlock(tx, "CUSTOMER", 0, 1);
      const code = `CUS-${firstOrdinal.toString().padStart(3, "0")}`;
      const { id } = await tx.customer.create({
        data: {
          ...data,
          code,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: { id: true },
      });
      if (opening) await addOpening(tx, actor, id, opening);
      await appendAuditEvent(tx, {
        ...customerEvent(actor, context, id),
        action: "customer.create",
        after: {
          code,
          isActive: data.isActive,
          creditLimit: data.creditLimit,
          ...openingSnapshot(opening),
        },
      });
      return { resourceIds: [id] };
    },
    async (tx) => {
      await requireLivePermission(tx, actor, "parties.manage");
    },
  );
  return { id: result.resourceIds[0] };
}

export async function updateCustomer(
  database: PrismaClient,
  actor: Actor,
  context: AuditContext,
  raw: unknown,
) {
  requirePermission(actor, "parties.manage");
  const fields = readFields(editSchema, raw);
  const { id, updatedAt } = fields;
  const data = customerData(fields);
  const opening = readOpening(actor, fields);

  await runIdempotentCommand(
    database,
    {
      actorId: actor.userId,
      operation: "customers.update",
      key: fields.requestKey,
      requestDigest: fingerprintCommand({
        id,
        updatedAt,
        ...data,
        ...openingSnapshot(opening),
      }),
      expiresAt: new Date(Date.now() + idempotencyHorizonMs),
    },
    async (tx) => {
      if (opening) await lockOpenBusinessMonths(tx, [opening.date]);
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.customer.findUnique({
        where: { id },
        select: {
          code: true,
          creditLimit: true,
          isActive: true,
          updatedAt: true,
        },
      });
      if (!current) throw new CustomerError("missing");
      if (current.updatedAt.getTime() !== new Date(updatedAt).getTime())
        throw new CustomerError("stale");

      if (opening) {
        const existing = await tx.ledgerEntry.findFirst({
          where: { customerId: id, kind: "CUSTOMER_OPENING", reversesId: null },
          select: { id: true },
        });
        if (existing) throw new CustomerError("openingExists");
        await addOpening(tx, actor, id, opening);
      }

      await tx.customer.update({
        where: { id },
        data: {
          ...data,
          updatedById: actor.userId,
          updatedAt: new Date(
            Math.max(Date.now(), current.updatedAt.getTime() + 1),
          ),
        },
        select: { id: true },
      });
      await appendAuditEvent(tx, {
        ...customerEvent(actor, context, id),
        action:
          !data.isActive && current.isActive
            ? "customer.deactivate"
            : "customer.update",
        before: {
          code: current.code,
          isActive: current.isActive,
          creditLimit: current.creditLimit?.toFixed(2) ?? null,
        },
        after: {
          code: current.code,
          isActive: data.isActive,
          creditLimit: data.creditLimit,
          ...openingSnapshot(opening),
        },
      });
      return { resourceIds: [id] };
    },
    async (tx) => {
      await requireLivePermission(tx, actor, "parties.manage");
    },
  );
  return { id };
}

export async function readCustomer(
  database: PrismaClient,
  actor: Actor,
  id: string,
) {
  requirePermission(actor, "parties.manage");
  if (!z.uuid().safeParse(id).success) return null;
  const customer = await database.customer.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      industry: true,
      contactPerson: true,
      phone: true,
      email: true,
      city: true,
      address: true,
      notes: true,
      isActive: true,
      creditLimit: true,
      updatedAt: true,
    },
  });
  if (!customer) return null;
  const opening = await database.ledgerEntry.findFirst({
    where: { customerId: id, kind: "CUSTOMER_OPENING", reversesId: null },
    select: { amount: true, businessDate: true },
  });
  return {
    ...customer,
    creditLimit: customer.creditLimit?.toFixed(2) ?? "",
    updatedAt: customer.updatedAt.toISOString(),
    opening: opening && {
      amount: opening.amount.toFixed(2),
      date: opening.businessDate.toISOString().slice(0, 10),
    },
  };
}

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export type CustomerFilters = {
  q: string;
  status: "all" | "active" | "inactive";
  page: number;
};

export function readCustomerFilters(
  query: Record<string, string | string[] | undefined>,
): CustomerFilters {
  const status = scalar(query.status);
  const page = Number(scalar(query.page));
  return {
    q: scalar(query.q).trim().slice(0, 120),
    status: status === "active" || status === "inactive" ? status : "all",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

type DirectoryEntry = { id: string; code: string; name: string };
type FullDirectoryEntry = DirectoryEntry & {
  industry: string | null;
  contactPerson: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  creditLimit: string | null;
};

const pageSize = 20;
const emptyActivity = {
  trucks: 0,
  weight: "0",
  billed: "0",
  settled: "0",
  balance: "0",
};

export async function listCustomers(
  database: PrismaClient,
  actor: Actor,
  filters: CustomerFilters,
) {
  requirePermission(actor, "parties.view");
  const manager = can(actor.roleCode, "parties.manage");
  const status = manager ? filters.status : "active";
  const q = filters.q.toLowerCase();
  const contactSearch = manager
    ? Prisma.sql`
    OR strpos(lower(COALESCE(customer.contact_person, '')), ${q}) > 0
    OR strpos(lower(COALESCE(customer.phone, '')), ${q}) > 0
    OR strpos(lower(COALESCE(customer.city, '')), ${q}) > 0
    OR strpos(lower(COALESCE(customer.industry, '')), ${q}) > 0
  `
    : Prisma.empty;

  const matches = Prisma.sql`
    FROM customers AS customer
    WHERE (${status} = 'all' OR customer.is_active = (${status} = 'active'))
      AND (${q} = '' OR strpos(customer.name_key, ${q}) > 0 OR strpos(lower(customer.code), ${q}) > 0 ${contactSearch})
  `;

  return database.$transaction(
    async (tx) => {
      const [{ count, active }] = await tx.$queryRaw<
        { count: bigint; active: bigint }[]
      >(Prisma.sql`
      SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE customer.is_active) AS active ${matches}
    `);
      const matchedCount = Number(count);
      const lastPage = Math.max(1, Math.ceil(matchedCount / pageSize));
      const page = Math.min(filters.page, lastPage);
      const pagination = Prisma.sql`ORDER BY customer.name_key, customer.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
      const paging = { page, lastPage, matchedCount, status };
      if (!manager) {
        const rows = await tx.$queryRaw<DirectoryEntry[]>(Prisma.sql`
        SELECT customer.id, customer.code, customer.name ${matches} ${pagination}
      `);
        return { ...paging, mode: "directory", rows } as const;
      }

      const rows = await tx.$queryRaw<FullDirectoryEntry[]>(Prisma.sql`
      SELECT customer.id, customer.code, customer.name, customer.industry, customer.contact_person AS "contactPerson",
        customer.phone, customer.city, customer.is_active AS "isActive", customer.credit_limit::text AS "creditLimit"
      ${matches} ${pagination}
    `);
      const asOf = todayBusinessDate();
      const [rollups, totals, preferences] = await Promise.all([
        getPartyRollups(
          tx,
          "customer",
          rows.map(({ id }) => id),
          asOf,
        ),
        getPartyRollupTotals(
          tx,
          "customer",
          Prisma.sql`SELECT customer.id ${matches}`,
          asOf,
        ),
        readDocumentDisplayPreferences(tx),
      ]);
      const byParty = new Map(
        rollups.map(({ partyId, ...entry }) => [partyId, entry]),
      );
      return {
        ...paging,
        mode: "financial",
        activeCount: Number(active),
        totals,
        preferences,
        rows: rows.map((row) => ({
          ...row,
          activity: byParty.get(row.id) ?? emptyActivity,
        })),
      } as const;
    },
    { isolationLevel: "RepeatableRead" },
  );
}
