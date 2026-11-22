import { z } from "zod";
import { requirePermission, type PermissionActor } from "@/domain/permissions";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

const inlineLimit = 40;
const searchLimit = 20;
const selection = { id: true, name: true, code: true };
const uuid = z.uuid();

export const salesPartyKinds = ["customer", "supplier"] as const;
export type SalesPartyKind = (typeof salesPartyKinds)[number];
export type SalesPartyOption = { id: string; name: string; code: string };
export type SalesPartyCatalog = {
  options: SalesPartyOption[];
  selected: SalesPartyOption | null;
  searchable: boolean;
};
export type SalesPartySearchResult = {
  options: SalesPartyOption[];
  hasMore: boolean;
};

async function readCatalog(
  database: PrismaClient,
  kind: SalesPartyKind,
  selectedId: unknown,
): Promise<SalesPartyCatalog> {
  const input = {
    select: selection,
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    take: inlineLimit + 1,
  } satisfies Prisma.CustomerFindManyArgs;
  const options =
    kind === "customer"
      ? await database.customer.findMany(input)
      : await database.supplier.findMany(input);
  const searchable = options.length > inlineLimit;
  const id = uuid.safeParse(selectedId).data?.toLowerCase();
  let selected = options.find((item) => item.id === id) ?? null;
  if (!selected && id && searchable) {
    const lookup = { select: selection, where: { id } };
    selected =
      kind === "customer"
        ? await database.customer.findUnique(lookup)
        : await database.supplier.findUnique(lookup);
  }
  return { options: searchable ? [] : options, selected, searchable };
}

export async function readSalesPartyCatalogs(
  database: PrismaClient,
  actor: PermissionActor,
  filters: { customerId?: unknown; supplierId?: unknown },
) {
  requirePermission(actor, "reports.view");
  return Promise.all([
    readCatalog(database, "customer", filters.customerId),
    readCatalog(database, "supplier", filters.supplierId),
  ] as const);
}

const searchInput = z.object({
  kind: z.enum(salesPartyKinds),
  query: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !value.includes("\0")),
});

export function parseSalesPartySearch(params: URLSearchParams) {
  if (params.getAll("kind").length !== 1 || params.getAll("q").length > 1)
    return null;
  const parsed = searchInput.safeParse({
    kind: params.get("kind"),
    query: params.get("q") ?? "",
  });
  return parsed.success ? parsed.data : null;
}

export async function searchSalesPartyCatalog(
  database: PrismaClient,
  actor: PermissionActor,
  { kind, query }: z.infer<typeof searchInput>,
): Promise<SalesPartySearchResult> {
  requirePermission(actor, "reports.view");
  const term = query.toLowerCase();
  const table =
    kind === "customer" ? Prisma.sql`customers` : Prisma.sql`suppliers`;
  const rows = await database.$queryRaw<SalesPartyOption[]>`
    SELECT id, name, code
    FROM ${table}
    WHERE ${term} = '' OR strpos(name_key, ${term}) > 0 OR strpos(lower(code), ${term}) > 0
    ORDER BY name_key, id
    LIMIT ${searchLimit + 1}
  `;
  return {
    options: rows.slice(0, searchLimit),
    hasMore: rows.length > searchLimit,
  };
}
