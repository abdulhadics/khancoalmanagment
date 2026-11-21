import { z } from "zod";

import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../domain/business-date";
import { parseMoney } from "../../domain/money";
import { requirePermission } from "../../domain/permissions";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  fingerprintCommand,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { reserveNumberBlock } from "../repositories/number-sequences";
import {
  getPartyRollups,
  getPartyRollupTotals,
} from "../repositories/party-ledger-rollups";
import { lockOpenBusinessMonths } from "../repositories/periods";

type SupplierErrorCode =
  "invalid" | "missing" | "changed" | "duplicateMine" | "inactiveDefault";

export class SupplierError extends Error {
  constructor(
    public readonly code: SupplierErrorCode,
    public readonly fields: readonly string[] = [],
  ) {
    super(code);
    this.name = "SupplierError";
  }
}

export const suppliersPageSize = 20;

const filterSchema = z.object({
  search: z.string().trim().max(100).catch("").default(""),
  status: z.enum(["all", "active", "inactive"]).catch("all").default("all"),
  page: z.coerce.number().int().min(1).max(25_000).catch(1).default(1),
});

const mineSelection = {
  id: true,
  code: true,
  name: true,
  isDefault: true,
} as const satisfies Prisma.MineSelect;

const supplierIdentity = {
  id: true,
  code: true,
  name: true,
  city: true,
  region: true,
  isActive: true,
} as const satisfies Prisma.SupplierSelect;

const supplierSort = [{ nameKey: "asc" }, { id: "asc" }] as const;
const sortMines = [
  { isDefault: "desc" },
  { codeKey: "asc" },
  { id: "asc" },
] as const;

function matchingSuppliers(
  search: string,
  status: "all" | "active" | "inactive",
) {
  const byStatus =
    status === "all"
      ? Prisma.empty
      : Prisma.sql`AND s.is_active = ${status === "active"}`;
  const key = search.toLowerCase();
  const bySearch = key
    ? Prisma.sql`AND (
        strpos(s.name_key, ${key}) > 0
        OR strpos(lower(s.code), ${key}) > 0
        OR strpos(lower(coalesce(s.city, '')), ${key}) > 0
        OR strpos(lower(coalesce(s.region, '')), ${key}) > 0
        OR EXISTS (
          SELECT 1 FROM mines AS m
          WHERE m.supplier_id = s.id AND m.is_active
            AND (strpos(m.code_key, ${key}) > 0 OR strpos(lower(m.name), ${key}) > 0)
        )
      )`
    : Prisma.empty;
  return Prisma.sql`SELECT s.id FROM suppliers AS s WHERE true ${byStatus} ${bySearch}`;
}

async function supplierPage(
  tx: Prisma.TransactionClient,
  matches: Prisma.Sql,
  requestedPage: number,
) {
  const [count] = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM (${matches}) AS matches
  `;
  const total = Number(count?.count ?? 0n);
  const pages = Math.max(1, Math.ceil(total / suppliersPageSize));
  const page = Math.min(pages, requestedPage);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.id
    FROM (${matches}) AS matches
    JOIN suppliers AS s ON s.id = matches.id
    ORDER BY s.name_key, s.id
    LIMIT ${suppliersPageSize} OFFSET ${(page - 1) * suppliersPageSize}
  `;
  return { page, pages, total, ids: rows.map(({ id }) => id) };
}

export async function listDispatchSuppliers(
  database: PrismaClient,
  actor: LivePrincipal,
  rawFilter: unknown = {},
) {
  requirePermission(actor, "parties.view");
  const { search, page } = filterSchema.parse(rawFilter);
  return database.$transaction(
    async (tx) => {
      const pager = await supplierPage(
        tx,
        matchingSuppliers(search, "active"),
        page,
      );
      const rows = await tx.supplier.findMany({
        where: { id: { in: pager.ids } },
        orderBy: [...supplierSort],
        select: {
          ...supplierIdentity,
          mines: {
            where: { isActive: true },
            select: mineSelection,
            orderBy: [...sortMines],
          },
        },
      });
      return {
        rows,
        page: pager.page,
        pages: pager.pages,
        total: pager.total,
        search,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function listSuppliers(
  database: PrismaClient,
  actor: LivePrincipal,
  rawFilter: unknown = {},
  now = new Date(),
) {
  requirePermission(actor, "parties.manage");
  const filter = filterSchema.parse(rawFilter);
  const matches = matchingSuppliers(filter.search, filter.status);
  const asOf = todayBusinessDate(now);
  return database.$transaction(
    async (tx) => {
      const pager = await supplierPage(tx, matches, filter.page);
      const rows = await tx.supplier.findMany({
        where: { id: { in: pager.ids } },
        orderBy: [...supplierSort],
        select: {
          ...supplierIdentity,
          contactPerson: true,
          phone: true,
          mines: {
            where: { isDefault: true, isActive: true },
            select: mineSelection,
          },
        },
      });
      const totals = await getPartyRollupTotals(tx, "supplier", matches, asOf);
      const rollups = await getPartyRollups(tx, "supplier", pager.ids, asOf);
      const byId = new Map(rollups.map((rollup) => [rollup.partyId, rollup]));
      return {
        rows: rows.map((row) => ({ ...row, totals: byId.get(row.id) })),
        page: pager.page,
        pages: pager.pages,
        total: pager.total,
        status: filter.status,
        search: filter.search,
        totals,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

const identifier = z.uuid();

export async function getSupplier(
  database: PrismaClient,
  actor: LivePrincipal,
  id: string,
) {
  requirePermission(actor, "parties.manage");
  if (!identifier.safeParse(id).success) return null;
  return database.supplier.findUnique({
    where: { id },
    select: {
      ...supplierIdentity,
      phone: true,
      email: true,
      contactPerson: true,
      address: true,
      notes: true,
      updatedAt: true,
      mines: {
        select: { ...mineSelection, isActive: true, updatedAt: true },
        orderBy: [...sortMines],
      },
    },
  });
}

export type SupplierDetails = NonNullable<
  Awaited<ReturnType<typeof getSupplier>>
>;

const nullableText = (length: number) =>
  z
    .string()
    .trim()
    .max(length)
    .transform((value) => value || null)
    .default(null);

const supplierFields = z.strictObject({
  name: z.string().trim().min(1).max(160),
  contactPerson: nullableText(120),
  phone: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^\+?[\d\s()\-]{7,25}$/),
    ])
    .transform((value) => value || null)
    .default(null),
  email: z
    .union([
      z.literal(""),
      z.string().trim().toLowerCase().max(254).pipe(z.email()),
    ])
    .transform((value) => value || null)
    .default(null),
  city: nullableText(120),
  region: nullableText(120),
  address: nullableText(500),
  notes: nullableText(1500),
  isActive: z.boolean().default(true),
});

const mineFields = z.strictObject({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const requestKey = z.uuid();
const version = z.iso.datetime();
const opening = z.strictObject({
  amount: z.string().trim().max(64),
  date: z.string().trim().length(10),
});

const commandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("create"),
    key: requestKey,
    fields: supplierFields,
    opening: opening.optional(),
    defaultMine: mineFields.optional(),
  }),
  z.strictObject({
    operation: z.literal("edit"),
    key: requestKey,
    supplierId: identifier,
    version,
    fields: supplierFields,
  }),
  z.strictObject({
    operation: z.literal("addMine"),
    key: requestKey,
    supplierId: identifier,
    fields: mineFields,
  }),
  z.strictObject({
    operation: z.literal("editMine"),
    key: requestKey,
    supplierId: identifier,
    mineId: identifier,
    version,
    fields: mineFields,
  }),
  z.strictObject({
    operation: z.literal("openingCorrection"),
    key: requestKey,
    supplierId: identifier,
    opening,
    reason: z.string().trim().min(1).max(500),
  }),
]);

async function lockSupplier(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${supplierId}::uuid FOR UPDATE`;
  const row = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, isActive: true, updatedAt: true },
  });
  if (!row) throw new SupplierError("missing");
  return row;
}

function openingValues(
  input: z.infer<typeof opening>,
  correction: boolean,
  now: Date,
) {
  let amount;
  let businessDate;
  try {
    amount = parseMoney(input.amount);
  } catch {
    throw new SupplierError("invalid", ["amount"]);
  }
  try {
    businessDate = parseBusinessDate(input.date);
  } catch {
    throw new SupplierError("invalid", ["date"]);
  }
  if ((correction && amount.isZero()) || (!correction && amount.isNegative())) {
    throw new SupplierError("invalid", ["amount"]);
  }
  if (input.date > todayBusinessDate(now))
    throw new SupplierError("invalid", ["date"]);
  return amount.isZero() ? null : { amount: amount.toFixed(2), businessDate };
}

async function saveMine(
  tx: Prisma.TransactionClient,
  supplierId: string,
  fields: z.infer<typeof mineFields>,
  priorId?: string,
) {
  if (fields.isDefault && !fields.isActive)
    throw new SupplierError("inactiveDefault");
  const codeKey = fields.code.toLowerCase();
  const match = await tx.mine.findUnique({
    where: { supplierId_codeKey: { supplierId, codeKey } },
    select: { id: true },
  });
  if (match && match.id !== priorId)
    throw new SupplierError("duplicateMine", ["code"]);
  let formerDefaultId: string | undefined;
  if (fields.isDefault) {
    const [formerDefault] = await tx.mine.updateManyAndReturn({
      where: {
        supplierId,
        isDefault: true,
        id: priorId ? { not: priorId } : undefined,
      },
      data: { isDefault: false },
      select: { id: true },
    });
    formerDefaultId = formerDefault?.id;
  }
  const data = { ...fields, codeKey };
  const mine = priorId
    ? await tx.mine.update({
        where: { id: priorId },
        data,
        select: { id: true },
      })
    : await tx.mine.create({
        data: { ...data, supplierId },
        select: { id: true },
      });
  return { id: mine.id, formerDefaultId };
}

type SupplierRequest = { requestId: string; ipAddress?: string };

export async function mutateSupplier(
  database: PrismaClient,
  actor: LivePrincipal,
  request: SupplierRequest,
  rawCommand: unknown,
  now = new Date(),
) {
  requirePermission(actor, "parties.manage");
  const parsed = commandSchema.safeParse(rawCommand);
  if (!parsed.success) {
    throw new SupplierError(
      "invalid",
      parsed.error.issues.map(({ path }) => String(path.at(-1))),
    );
  }
  const command = parsed.data;
  const hasOpening =
    command.operation === "openingCorrection" ||
    (command.operation === "create" && command.opening !== undefined);
  if (hasOpening) requirePermission(actor, "parties.openingBalance");
  const posting =
    "opening" in command && command.opening
      ? openingValues(
          command.opening,
          command.operation === "openingCorrection",
          now,
        )
      : null;
  const result = await runIdempotentCommand(
    database,
    {
      actorId: actor.userId,
      key: command.key,
      operation: `supplier.${command.operation}`,
      requestDigest: fingerprintCommand(command),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    },
    async (tx) => {
      const event = {
        ...request,
        actor: { type: "USER", id: actor.userId },
        area: "parties",
        outcome: "SUCCESS",
      } as const;
      if (posting) await lockOpenBusinessMonths(tx, [posting.businessDate]);

      if (command.operation === "create") {
        const { firstOrdinal } = await reserveNumberBlock(tx, "SUPPLIER", 0, 1);
        const code = `SUP-${String(firstOrdinal).padStart(3, "0")}`;
        const supplier = await tx.supplier.create({
          data: {
            ...command.fields,
            code,
            nameKey: command.fields.name.toLowerCase(),
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          select: { id: true },
        });
        if (posting) {
          await tx.ledgerEntry.create({
            data: {
              ...posting,
              kind: "SUPPLIER_OPENING",
              supplierId: supplier.id,
              actorId: actor.userId,
            },
          });
        }
        if (command.defaultMine) {
          const mine = await saveMine(tx, supplier.id, {
            ...command.defaultMine,
            isActive: true,
            isDefault: true,
          });
          await appendAuditEvent(tx, {
            ...event,
            action: "mine.add",
            targetType: "mine",
            targetId: mine.id,
            after: {
              supplierId: supplier.id,
              code: command.defaultMine.code,
              isDefault: true,
              isActive: true,
            },
          });
        }
        await appendAuditEvent(tx, {
          ...event,
          action: "supplier.create",
          targetType: "supplier",
          targetId: supplier.id,
          after: {
            name: command.fields.name,
            code,
            isActive: command.fields.isActive,
            openingAmount: posting?.amount ?? null,
            openingDate: command.opening?.date ?? null,
          },
        });
        return { resourceIds: [supplier.id] };
      }

      const supplier = await lockSupplier(tx, command.supplierId);
      if (command.operation === "edit") {
        if (supplier.updatedAt.toISOString() !== command.version)
          throw new SupplierError("changed");
        await tx.supplier.update({
          where: { id: supplier.id },
          data: {
            ...command.fields,
            nameKey: command.fields.name.toLowerCase(),
            updatedById: actor.userId,
          },
          select: { id: true },
        });
        await appendAuditEvent(tx, {
          ...event,
          action: "supplier.edit",
          targetType: "supplier",
          targetId: supplier.id,
          before: { name: supplier.name, isActive: supplier.isActive },
          after: {
            name: command.fields.name,
            isActive: command.fields.isActive,
          },
        });
        return { resourceIds: [supplier.id] };
      }

      if (command.operation === "openingCorrection") {
        if (!posting) throw new SupplierError("invalid", ["amount"]);
        const entry = await tx.ledgerEntry.create({
          data: {
            ...posting,
            kind: "SUPPLIER_ADJUSTMENT",
            supplierId: supplier.id,
            actorId: actor.userId,
            reason: command.reason,
          },
          select: { id: true },
        });
        await appendAuditEvent(tx, {
          ...event,
          action: "supplier.opening-correction",
          targetType: "supplier",
          targetId: supplier.id,
          after: {
            ledgerEntryId: String(entry.id),
            amount: posting.amount,
            date: command.opening.date,
          },
        });
        return { resourceIds: [supplier.id] };
      }

      const prior =
        command.operation === "editMine"
          ? await tx.mine.findUnique({
              where: {
                supplierId_id: { supplierId: supplier.id, id: command.mineId },
              },
            })
          : null;
      if (command.operation === "editMine") {
        if (!prior) throw new SupplierError("missing");
        if (prior.updatedAt.toISOString() !== command.version)
          throw new SupplierError("changed");
      }
      const mine = await saveMine(tx, supplier.id, command.fields, prior?.id);
      if (mine.formerDefaultId) {
        await appendAuditEvent(tx, {
          ...event,
          action: "mine.default-cleared",
          targetType: "mine",
          targetId: mine.formerDefaultId,
          before: { isDefault: true },
          after: { isDefault: false },
        });
      }
      await appendAuditEvent(tx, {
        ...event,
        action: prior ? "mine.edit" : "mine.add",
        targetType: "mine",
        targetId: mine.id,
        before: prior
          ? {
              code: prior.code,
              name: prior.name,
              isActive: prior.isActive,
              isDefault: prior.isDefault,
            }
          : undefined,
        after: { supplierId: supplier.id, ...command.fields },
      });
      return { resourceIds: [supplier.id, mine.id] };
    },
    (tx) =>
      requireLivePermission(
        tx,
        actor,
        hasOpening ? "parties.openingBalance" : "parties.manage",
        now,
      ),
  );
  return { supplierId: result.resourceIds[0]! };
}
