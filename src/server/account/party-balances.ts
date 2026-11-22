import { Prisma } from "@/generated/prisma/client";
import {
  outstandingBalanceTotals,
  partyBalancesQuery,
  partyLedgerRollupQuery,
} from "../repositories/party-ledger-rollups";
import type {
  AccountParty,
  AccountPartyFilters,
  PendingPartyRow,
} from "./workspace";

export const accountPageSize = 20;

export function accountPageNumber(page?: number) {
  return page !== undefined && Number.isSafeInteger(page) && page >= 1
    ? page
    : 1;
}

export function accountSearch(q?: string) {
  return q?.trim().slice(0, 120) ?? "";
}

type PartyPage = {
  matchedCount: number;
  page: number;
  lastPage: number;
  rows: PendingPartyRow[];
};

export function accountPartyTable(party: AccountParty) {
  return party === "customer" ? Prisma.sql`customers` : Prisma.sql`suppliers`;
}

function partyPageQuery(
  party: AccountParty,
  filters: AccountPartyFilters = {},
  asOf: string,
) {
  const q = accountSearch(filters.q).toLowerCase();
  const search = q
    ? Prisma.sql`AND (strpos(party.name_key, ${q}) > 0 OR strpos(lower(party.code), ${q}) > 0)`
    : Prisma.empty;
  const state =
    filters.status === "pending"
      ? Prisma.sql`AND rollup.balance > 0`
      : filters.status === "clear"
        ? Prisma.sql`AND COALESCE(rollup.balance, 0) <= 0`
        : Prisma.empty;
  const column =
    party === "customer"
      ? Prisma.sql`rollup.customer_id`
      : Prisma.sql`rollup.supplier_id`;
  const sort = Prisma.sql`balance DESC, name_key, id`;
  return Prisma.sql`
    WITH matched AS MATERIALIZED (
      SELECT party.id, party.code, party.name, party.name_key, party.is_active,
        COALESCE(rollup.balance, 0) AS balance
      FROM ${accountPartyTable(party)} AS party
      LEFT JOIN balances AS rollup ON ${column} = party.id
      WHERE true ${state} ${search}
    ), page_count AS (
      SELECT count(*) AS "matchedCount",
        greatest(1, (count(*) + ${accountPageSize - 1}) / ${accountPageSize}) AS "lastPage"
      FROM matched
    ), bounds AS (
      SELECT *, least("lastPage", ${accountPageNumber(filters.page)}) AS page FROM page_count
    ), visible AS MATERIALIZED (
      SELECT * FROM matched ORDER BY ${sort}
      LIMIT ${accountPageSize} OFFSET (SELECT (page - 1) * ${accountPageSize} FROM bounds)
    ), entries AS (
      SELECT visible.id, visible.code, visible.name, visible.name_key, visible.balance, visible.is_active,
        COALESCE(rollup.billed, 0) AS billed, COALESCE(rollup.settled, 0) AS settled
      FROM visible
      LEFT JOIN (${partyLedgerRollupQuery(party, Prisma.sql`SELECT id FROM visible`, asOf)}) AS rollup
        ON visible.id = rollup."partyId"
    )
    SELECT to_jsonb(bounds) || jsonb_build_object('rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'name', name, 'isActive', is_active,
        'billed', billed::text, 'settled', settled::text, 'balance', balance::text,
        'pending', GREATEST(balance, 0)::text, 'advance', GREATEST(-balance, 0)::text
      ) ORDER BY ${sort}) FROM entries
    ), '[]'::jsonb))
    FROM bounds
  `;
}

export async function readAccountPartyBalances(
  tx: Prisma.TransactionClient,
  filters: { customers?: AccountPartyFilters; suppliers?: AccountPartyFilters },
  asOf: string,
) {
  const [result] = await tx.$queryRaw<
    {
      receivable: string;
      payable: string;
      customers: PartyPage;
      suppliers: PartyPage;
    }[]
  >`
    WITH balances AS MATERIALIZED (${partyBalancesQuery(asOf)})
    SELECT ${outstandingBalanceTotals},
      (${partyPageQuery("customer", filters.customers, asOf)}) AS customers,
      (${partyPageQuery("supplier", filters.suppliers, asOf)}) AS suppliers
    FROM balances
  `;
  return result;
}
