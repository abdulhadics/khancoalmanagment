import { z } from "zod";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { requirePermission, type PermissionActor } from "@/domain/permissions";
import {
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type BankCategory,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getCashMovementTotals } from "../repositories/cash-movement";
import {
  getPartyRollups,
  partyLedgerRollupQuery,
} from "../repositories/party-ledger-rollups";
import { readDocumentDisplayPreferences } from "../settings/company";
import {
  accountPageNumber,
  accountPageSize,
  accountPartyTable,
  accountSearch,
  readAccountPartyBalances,
} from "./party-balances";

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

export type PaymentFormOptions = {
  businessDate: string;
  parties: (PartyIdentity & { balance?: string })[];
  banks: { id: string; name: string; category: BankCategory }[];
};

export type PendingPartyRow = PartyIdentity & {
  isActive: boolean;
  billed: string;
  settled: string;
  balance: string;
  pending: string;
  advance: string;
};

function readDateFilter(date?: string) {
  if (!date) return undefined;
  try {
    return parseBusinessDate(date);
  } catch {
    return undefined;
  }
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
  const search = accountSearch(filters.q).replace(/[%_\\]/g, "\\$&");
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
  const lastPage = Math.max(1, Math.ceil(matchedCount / accountPageSize));
  const page = Math.min(accountPageNumber(filters.page), lastPage);
  const records = await tx.payment.findMany({
    where,
    orderBy: [{ businessDate: "desc" }, { ordinal: "desc" }],
    skip: (page - 1) * accountPageSize,
    take: accountPageSize,
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

async function readVoucherSummary(tx: Prisma.TransactionClient, asOf: string) {
  const uncleared = Prisma.sql`method = 'CHEQUE' AND status IN ('RECEIVED', 'DEPOSITED')`;
  const [summary] = await tx.$queryRaw<
    { voucherCount: bigint; unclearedReceived: string; unclearedPaid: string }[]
  >`
    SELECT COUNT(*) AS "voucherCount",
      COALESCE(SUM(amount) FILTER (WHERE ${uncleared} AND direction = 'IN'), 0)::text AS "unclearedReceived",
      COALESCE(SUM(amount) FILTER (WHERE ${uncleared} AND direction = 'OUT'), 0)::text AS "unclearedPaid"
    FROM payments
    WHERE business_date <= ${asOf}::date
  `;
  return { ...summary, voucherCount: Number(summary.voucherCount) };
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
      const [cash, vouchers, partyBalances, transactions, preferences] =
        await Promise.all([
          getCashMovementTotals(tx, { through: asOf }),
          readVoucherSummary(tx, asOf),
          readAccountPartyBalances(tx, filters, asOf),
          readTransactions(tx, filters.vouchers, asOf),
          readDocumentDisplayPreferences(tx),
        ]);
      const { customers, suppliers, ...balances } = partyBalances;
      const summary = { ...cash, ...balances, ...vouchers };
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

const activeBankOptions = {
  where: { isActive: true },
  orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  select: { id: true, name: true, category: true },
} satisfies Prisma.BankFindManyArgs;

const activePartyOptions = {
  where: { isActive: true },
  orderBy: [{ nameKey: "asc" }, { id: "asc" }],
  select: { id: true, code: true, name: true },
} satisfies Prisma.CustomerFindManyArgs & Prisma.SupplierFindManyArgs;

export async function readAccountFormCatalog(
  database: PrismaClient,
  actor: PermissionActor,
) {
  requirePermission(actor, "account.manage");
  const businessDate = todayBusinessDate();
  const [customers, suppliers, banks] = await database.$transaction([
    database.customer.findMany(activePartyOptions),
    database.supplier.findMany(activePartyOptions),
    database.bank.findMany(activeBankOptions),
  ]);
  return {
    receipt: { businessDate, parties: customers, banks },
    payment: { businessDate, parties: suppliers, banks },
  } satisfies Record<"receipt" | "payment", PaymentFormOptions>;
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
  const table = accountPartyTable(party);
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
        tx.bank.findMany(activeBankOptions),
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
  const table = accountPartyTable(party);
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
