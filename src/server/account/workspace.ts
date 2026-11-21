import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { requirePermission, type PermissionActor } from "@/domain/permissions";
import {
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getCashMovementTotals } from "../repositories/cash-movement";
import {
  getPartyRollups,
  getPartyRollupTotals,
  partyLedgerRollupQuery,
} from "../repositories/party-ledger-rollups";
import { readDocumentDisplayPreferences } from "../settings/company";

export type AccountParty = "customer" | "supplier";
export type AccountPartyStatus = "all" | "pending" | "clear";

export type AccountPartyFilters = {
  q?: string;
  page?: number;
  status?: AccountPartyStatus;
};

export type VoucherFilters = {
  q?: string;
  page?: number;
  direction?: PaymentDirection;
  method?: PaymentMethod;
  status?: PaymentStatus;
  from?: string;
  to?: string;
};

export type AccountFilters = {
  customers?: AccountPartyFilters;
  suppliers?: AccountPartyFilters;
  vouchers?: VoucherFilters;
};

type PartyIdentity = { id: string; code: string; name: string };

export type PendingPartyRow = PartyIdentity & {
  isActive: boolean;
  billed: string;
  settled: string;
  balance: string;
  pending: string;
  advance: string;
};

const pageSize = 20;

function partyTable(party: AccountParty) {
  return party === "customer" ? Prisma.sql`customers` : Prisma.sql`suppliers`;
}

function pageNumber(page?: number) {
  return page !== undefined && Number.isSafeInteger(page) && page >= 1
    ? page
    : 1;
}

function textSearch(q?: string) {
  return q?.trim().slice(0, 120) ?? "";
}

function readDateFilter(date?: string) {
  if (!date) return undefined;
  try {
    return parseBusinessDate(date);
  } catch {
    return undefined;
  }
}

async function readPendingParties(
  tx: Prisma.TransactionClient,
  party: AccountParty,
  filters: AccountPartyFilters = {},
  asOf: string,
) {
  const q = textSearch(filters.q).toLowerCase();
  const status =
    filters.status === "pending" || filters.status === "clear"
      ? filters.status
      : "all";
  const table = partyTable(party);
  const source = Prisma.sql`
    FROM ${table} AS party
    WHERE (${q} = '' OR strpos(party.name_key, ${q}) > 0 OR strpos(lower(party.code), ${q}) > 0)
  `;
  const scope = Prisma.sql`
    WITH matched AS (
      SELECT party.id, party.code, party.name, party.name_key, party.is_active ${source}
    ), values_by_party AS (
      SELECT matched.*, COALESCE(rollups.billed, 0) AS billed,
        COALESCE(rollups.settled, 0) AS settled, COALESCE(rollups.balance, 0) AS balance
      FROM matched LEFT JOIN (${partyLedgerRollupQuery(party, Prisma.sql`SELECT id FROM matched`, asOf)}) AS rollups
        ON matched.id = rollups."partyId"
    )
  `;
  const state =
    status === "pending"
      ? Prisma.sql`WHERE balance > 0`
      : status === "clear"
        ? Prisma.sql`WHERE balance <= 0`
        : Prisma.empty;
  const [{ count }] =
    status === "all"
      ? await tx.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS count ${source}`,
        )
      : await tx.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`${scope} SELECT COUNT(*) AS count FROM values_by_party ${state}`,
        );
  const matchedCount = Number(count);
  const lastPage = Math.max(1, Math.ceil(matchedCount / pageSize));
  const page = Math.min(pageNumber(filters.page), lastPage);
  const rows = matchedCount
    ? await tx.$queryRaw<PendingPartyRow[]>(Prisma.sql`
    ${scope}
    SELECT id, code, name, is_active AS "isActive", billed::text, settled::text, balance::text,
      GREATEST(balance, 0)::text AS pending, GREATEST(-balance, 0)::text AS advance
    FROM values_by_party ${state}
    ORDER BY balance DESC, name_key, id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `)
    : [];
  return { page, lastPage, matchedCount, rows };
}

const voucherFields = {
  id: true,
  businessDate: true,
  voucherNo: true,
  direction: true,
  amount: true,
  method: true,
  bankId: true,
  bankName: true,
  referenceNo: true,
  status: true,
  notes: true,
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} as const satisfies Prisma.PaymentSelect;

async function readTransactions(
  tx: Prisma.TransactionClient,
  filters: VoucherFilters = {},
  asOf: string,
) {
  const search = textSearch(filters.q).replace(/[%_\\]/g, "\\$&");
  const contains = { contains: search, mode: "insensitive" } as const;
  const end =
    filters.to && filters.to < asOf ? readDateFilter(filters.to) : undefined;
  const start = readDateFilter(filters.from);
  const direction =
    filters.direction && Object.hasOwn(PaymentDirection, filters.direction)
      ? filters.direction
      : undefined;
  const method =
    filters.method && Object.hasOwn(PaymentMethod, filters.method)
      ? filters.method
      : undefined;
  const status =
    filters.status && Object.hasOwn(PaymentStatus, filters.status)
      ? filters.status
      : undefined;
  const where = {
    direction,
    method,
    status,
    businessDate: { gte: start, lte: end ?? parseBusinessDate(asOf) },
    ...(search
      ? {
          OR: [
            { voucherNo: contains },
            { referenceNo: contains },
            { bankName: contains },
            { customer: { is: { name: contains } } },
            { supplier: { is: { name: contains } } },
          ],
        }
      : {}),
  } satisfies Prisma.PaymentWhereInput;
  const matchedCount = await tx.payment.count({ where });
  const lastPage = Math.max(1, Math.ceil(matchedCount / pageSize));
  const page = Math.min(pageNumber(filters.page), lastPage);
  const records = await tx.payment.findMany({
    where,
    orderBy: [{ businessDate: "desc" }, { ordinal: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: voucherFields,
  });
  const rows = records.map(
    ({ customer, supplier, businessDate, amount, ...row }) => {
      const party = customer ?? supplier;
      if (!party) throw new Error("Voucher is missing its issued party.");
      return {
        ...row,
        partyId: party.id,
        partyName: party.name,
        businessDate: businessDate.toISOString().slice(0, 10),
        amount: amount.toFixed(2),
      };
    },
  );
  return { page, lastPage, matchedCount, rows };
}

async function readAccountSummary(tx: Prisma.TransactionClient, asOf: string) {
  const [cash, customers, suppliers, vouchers, uncleared] = await Promise.all([
    getCashMovementTotals(tx, { through: asOf }),
    getPartyRollupTotals(
      tx,
      "customer",
      Prisma.sql`SELECT id FROM customers`,
      asOf,
    ),
    getPartyRollupTotals(
      tx,
      "supplier",
      Prisma.sql`SELECT id FROM suppliers`,
      asOf,
    ),
    tx.payment.count({
      where: { businessDate: { lte: parseBusinessDate(asOf) } },
    }),
    tx.payment.groupBy({
      by: ["direction"],
      where: {
        businessDate: { lte: parseBusinessDate(asOf) },
        method: "CHEQUE",
        status: { in: ["RECEIVED", "DEPOSITED"] },
      },
      _sum: { amount: true },
    }),
  ]);
  return {
    ...cash,
    receivable: customers.due,
    payable: suppliers.due,
    voucherCount: vouchers,
    unclearedReceived:
      uncleared
        .find(({ direction }) => direction === "IN")
        ?._sum.amount?.toFixed(2) ?? "0",
    unclearedPaid:
      uncleared
        .find(({ direction }) => direction === "OUT")
        ?._sum.amount?.toFixed(2) ?? "0",
  };
}

export async function readAccountWorkspace(
  database: PrismaClient,
  actor: PermissionActor,
  filters: AccountFilters = {},
) {
  requirePermission(actor, "account.view");
  const asOf = todayBusinessDate();
  return database.$transaction(
    async (tx) => {
      const [summary, customers, suppliers, transactions, preferences] =
        await Promise.all([
          readAccountSummary(tx, asOf),
          readPendingParties(tx, "customer", filters.customers, asOf),
          readPendingParties(tx, "supplier", filters.suppliers, asOf),
          readTransactions(tx, filters.vouchers, asOf),
          readDocumentDisplayPreferences(tx),
        ]);
      return { asOf, summary, customers, suppliers, transactions, preferences };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

function optionDate(input = todayBusinessDate()) {
  parseBusinessDate(input);
  if (input > todayBusinessDate())
    throw new RangeError("Payment date must be today or earlier.");
  return input;
}

function directionParty(direction: PaymentDirection): AccountParty {
  if (direction === "IN") return "customer";
  if (direction === "OUT") return "supplier";
  throw new RangeError("Unknown payment direction.");
}

export async function readAccountFormOptions(
  database: PrismaClient,
  actor: PermissionActor,
  direction: PaymentDirection,
  businessDate?: string,
) {
  requirePermission(actor, "account.manage");
  const date = optionDate(businessDate);
  const party = directionParty(direction);
  const table = partyTable(party);
  return database.$transaction(
    async (tx) => {
      const matches = Prisma.sql`SELECT id FROM ${table} WHERE is_active`;
      const [parties, banks] = await Promise.all([
        tx.$queryRaw<Array<PartyIdentity & { balance: string }>>(Prisma.sql`
        SELECT choice.id, choice.code, choice.name, COALESCE(rollups.balance, 0)::text AS balance
        FROM ${table} AS choice
        LEFT JOIN (${partyLedgerRollupQuery(party, matches, date)}) AS rollups ON rollups."partyId" = choice.id
        WHERE choice.is_active ORDER BY choice.name_key, choice.id
      `),
        tx.bank.findMany({
          where: { isActive: true },
          orderBy: [{ nameKey: "asc" }, { id: "asc" }],
          select: { id: true, name: true, category: true },
        }),
      ]);
      return { businessDate: date, parties, banks };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function readPaymentPartyBalance(
  database: PrismaClient,
  actor: PermissionActor,
  direction: PaymentDirection,
  partyId: string,
  businessDate?: string,
) {
  requirePermission(actor, "account.manage");
  if (!z.uuid().safeParse(partyId).success) return null;
  const date = optionDate(businessDate);
  const party = directionParty(direction);
  const id = partyId.toLowerCase();
  const table = partyTable(party);
  return database.$transaction(
    async (tx) => {
      const [active] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM ${table} WHERE id = ${id}::uuid AND is_active
    `);
      if (!active) return null;
      const [amounts] = await getPartyRollups(tx, party, [active.id], date);
      return {
        id: active.id,
        businessDate: date,
        balance: amounts?.balance ?? "0",
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
