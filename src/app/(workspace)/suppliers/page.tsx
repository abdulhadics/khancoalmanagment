import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { PartyActions } from "@/components/workspace/party-actions";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { suppliersMessages as t } from "@/i18n/messages/suppliers-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  listDispatchSuppliers,
  listSuppliers,
} from "@/server/parties/suppliers";
import { readDocumentDisplayPreferences } from "@/server/settings/company";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: t.title };

const filterInput =
  "h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const cell = "px-4 py-3 align-top";
const numeric = `${cell} text-end tabular-nums whitespace-nowrap`;

function SupplierFilters({
  search,
  status,
}: {
  search: string;
  status?: "all" | "active" | "inactive";
}) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-[min(100%,16rem)] flex-1 gap-1.5 text-sm font-medium">
        {t.search}
        <span className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-3 text-muted-foreground"
            size={15}
            aria-hidden
          />
          <input
            name="search"
            type="search"
            defaultValue={search}
            maxLength={100}
            placeholder={t.searchHelp}
            className={`${filterInput} w-full ps-9`}
          />
        </span>
      </label>
      {status && (
        <label className="grid gap-1.5 text-sm font-medium">
          {t.status}
          <select className={filterInput} name="status" defaultValue={status}>
            <option value="all">{t.all}</option>
            <option value="active">{t.active}</option>
            <option value="inactive">{t.inactive}</option>
          </select>
        </label>
      )}
      <Button type="submit" variant="outline">
        {t.filter}
      </Button>
      {(search || (status && status !== "all")) && (
        <Button variant="ghost" asChild>
          <Link href="/suppliers">{t.clear}</Link>
        </Button>
      )}
    </form>
  );
}

function SupplierPager({
  page,
  pages,
  total,
  search,
  status,
}: {
  page: number;
  pages: number;
  total: number;
  search: string;
  status?: string;
}) {
  if (pages <= 1) return null;
  function href(nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (search) params.set("search", search);
    if (status && status !== "all") params.set("status", status);
    return `/suppliers?${params}`;
  }
  return (
    <nav
      aria-label={t.title}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm"
    >
      <p className="text-muted-foreground">{t.page(page, pages, total)}</p>
      <div className="flex gap-2">
        {page > 1 && (
          <Button variant="outline" className="h-8 px-3" asChild>
            <Link href={href(page - 1)}>{t.previous}</Link>
          </Button>
        )}
        {page < pages && (
          <Button variant="outline" className="h-8 px-3" asChild>
            <Link href={href(page + 1)}>{t.next}</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}

function EmptySuppliers() {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-12 text-center">
      <Building2 size={26} className="mb-1 text-muted-foreground" aria-hidden />
      <h2 className="font-semibold">{t.empty}</h2>
      <p className="text-sm text-muted-foreground">{t.emptyHelp}</p>
    </div>
  );
}

function SupplierStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="@container min-w-0 border-border p-3 sm:p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`mt-2 whitespace-nowrap font-semibold tabular-nums ${highlight ? "text-destructive" : ""}`}
        style={{ fontSize: `min(1.4rem, ${145 / value.length}cqi)` }}
      >
        {value}
      </dd>
    </div>
  );
}

export default async function SuppliersPage({ searchParams }: PageProps) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.view")) notFound();
  const filters = await searchParams;
  const database = getDatabase();

  if (!can(actor.roleCode, "parties.manage")) {
    const directory = await listDispatchSuppliers(database, actor, filters);
    return (
      <>
        <header className="page-heading">
          <h1>{t.title}</h1>
          <p>{t.directory}</p>
        </header>
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <div className="p-4">
            <SupplierFilters search={directory.search} />
          </div>
          {directory.rows.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {directory.rows.map((supplier) => (
                <li
                  key={supplier.id}
                  className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_1.5fr]"
                >
                  <div>
                    <p className="font-semibold [overflow-wrap:anywhere]">
                      {supplier.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[supplier.code, supplier.city ?? supplier.region]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {supplier.mines.length
                      ? supplier.mines.map((mine) => (
                          <p key={mine.id} className="[overflow-wrap:anywhere]">
                            {mine.code} · {mine.name}
                            {mine.isDefault ? ` · ${t.defaultMine}` : ""}
                          </p>
                        ))
                      : t.noActiveMines}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptySuppliers />
          )}
          <SupplierPager {...directory} />
        </div>
      </>
    );
  }

  const [directory, preferences] = await Promise.all([
    listSuppliers(database, actor, filters),
    readDocumentDisplayPreferences(database),
  ]);
  const weightLabel = t.weightUnits[preferences.weightUnit];
  const money = (value: string) => formatCurrency(value, preferences);
  const weight = (value: string) =>
    `${formatDecimal(value, 3, preferences.numberFormat)} ${weightLabel}`;
  const trucks = (value: number) =>
    formatDecimal(BigInt(value), 0, preferences.numberFormat);
  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <Button asChild>
          <Link href="/suppliers/new">
            <Plus size={17} aria-hidden />
            {t.add}
          </Link>
        </Button>
      </header>
      <dl className="mb-5 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-[var(--radius)] border border-border bg-card sm:grid-cols-3 2xl:grid-cols-6">
        <SupplierStat
          label={t.trucks}
          value={trucks(directory.totals.trucks)}
        />
        <SupplierStat
          label={t.weight}
          value={weight(directory.totals.weight)}
        />
        <SupplierStat
          label={t.purchased}
          value={money(directory.totals.billed)}
        />
        <SupplierStat label={t.paid} value={money(directory.totals.settled)} />
        <SupplierStat
          label={t.payable}
          value={money(directory.totals.due)}
          highlight
        />
        <SupplierStat
          label={t.advance}
          value={money(directory.totals.advance)}
        />
      </dl>
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <div className="p-4">
          <SupplierFilters
            search={directory.search}
            status={directory.status}
          />
        </div>
        {directory.rows.length ? (
          <div
            className="overflow-x-auto border-t border-border"
            tabIndex={0}
            aria-label={t.title}
            role="region"
          >
            <table className="w-full min-w-[58rem] text-start text-sm">
              <caption className="sr-only">{t.title}</caption>
              <thead className="border-b border-border bg-muted/65 text-muted-foreground">
                <tr>
                  {[t.supplier, t.contact, t.defaultMine].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className={`${cell} text-start font-semibold`}
                    >
                      {label}
                    </th>
                  ))}
                  {[t.trucks, t.weight, t.purchased, t.paid, t.payable].map(
                    (label) => (
                      <th
                        key={label}
                        scope="col"
                        className={`${numeric} font-semibold`}
                      >
                        {label}
                      </th>
                    ),
                  )}
                  <th
                    scope="col"
                    className={`${cell} text-start font-semibold`}
                  >
                    {t.status}
                  </th>
                  <th scope="col" className="sr-only">
                    {t.edit}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {directory.rows.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-muted/30">
                    <td className={cell}>
                      <Link
                        className="font-semibold hover:underline [overflow-wrap:anywhere]"
                        href={`/suppliers/${supplier.id}`}
                      >
                        {supplier.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[supplier.code, supplier.city ?? supplier.region]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className={cell}>
                      <p className="[overflow-wrap:anywhere]">
                        {supplier.contactPerson ?? t.unspecified}
                      </p>
                      {supplier.phone && (
                        <p className="whitespace-nowrap text-xs text-muted-foreground">
                          {supplier.phone}
                        </p>
                      )}
                    </td>
                    <td className={cell}>
                      {supplier.mines[0]?.code ?? t.noDefault}
                    </td>
                    <td className={numeric}>
                      {trucks(supplier.totals?.trucks ?? 0)}
                    </td>
                    <td className={numeric}>
                      {weight(supplier.totals?.weight ?? "0")}
                    </td>
                    <td className={numeric}>
                      {money(supplier.totals?.billed ?? "0")}
                    </td>
                    <td className={numeric}>
                      {money(supplier.totals?.settled ?? "0")}
                    </td>
                    <td className={`${numeric} font-semibold`}>
                      {money(supplier.totals?.balance ?? "0")}
                    </td>
                    <td className={cell}>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${supplier.isActive ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"}`}
                      >
                        {supplier.isActive ? t.active : t.inactive}
                      </span>
                    </td>
                    <td className="p-2 text-end">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap font-medium text-primary">
                        <PartyActions
                          kind="supplier"
                          id={supplier.id}
                          active={supplier.isActive}
                        />
                        <Button variant="ghost" className="h-8 px-3" asChild>
                          <Link href={`/suppliers/${supplier.id}`}>
                            {t.edit}
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptySuppliers />
        )}
        <SupplierPager {...directory} />
      </div>
    </>
  );
}
