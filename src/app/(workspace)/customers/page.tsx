import { Decimal } from "decimal.js";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { customersMessages as t } from "@/i18n/messages/customers-en";
import { requireActor } from "@/server/auth/request-context";
import {
  listCustomers,
  readCustomerFilters,
  type CustomerFilters,
} from "@/server/customers";
import { getDatabase } from "@/server/db/client";

type FinancialList = Extract<
  Awaited<ReturnType<typeof listCustomers>>,
  { mode: "financial" }
>;

function FilterBar({
  filters,
  financial,
}: {
  filters: CustomerFilters;
  financial: boolean;
}) {
  return (
    <form
      action="/customers"
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius)] border border-border bg-card p-4"
    >
      <div className="min-w-44 flex-1 space-y-1.5">
        <label
          htmlFor="customer-search"
          className="block text-sm font-semibold"
        >
          {t.search}
        </label>
        <div className="relative">
          <Search
            size={17}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={
              financial ? t.searchPlaceholder : t.directorySearchPlaceholder
            }
            maxLength={120}
            className="min-h-10 w-full rounded-lg border border-border bg-card ps-9 pe-3 text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {financial && (
        <div className="space-y-1.5">
          <label
            htmlFor="customer-filter-status"
            className="block text-sm font-semibold"
          >
            {t.status}
          </label>
          <select
            id="customer-filter-status"
            name="status"
            defaultValue={filters.status}
            className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="all">{t.all}</option>
            <option value="active">{t.active}</option>
            <option value="inactive">{t.inactive}</option>
          </select>
        </div>
      )}
      <Button type="submit" variant="outline">
        {t.apply}
      </Button>
      {(filters.q || (financial && filters.status !== "all")) && (
        <Button asChild variant="ghost">
          <Link href="/customers">{t.clear}</Link>
        </Button>
      )}
    </form>
  );
}

function Summary({ list }: { list: FinancialList }) {
  const { totals, activeCount, matchedCount, preferences } = list;
  const amount = (value: string) => formatCurrency(value, preferences);
  const metrics = [
    { label: t.activeCount, value: `${activeCount} / ${matchedCount}` },
    { label: t.sales, value: amount(totals.billed) },
    { label: t.received, value: amount(totals.settled) },
    { label: t.due, value: amount(totals.due) },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      {metrics.map(({ label, value }) => (
        <div
          key={label}
          className="@container min-w-0 rounded-[var(--radius)] border border-border bg-card px-4 py-4"
        >
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd
            className={`mt-2 font-semibold tracking-tight whitespace-nowrap tabular-nums ${value.length > 23 ? "text-[min(4.5cqi,1.2rem)]" : "text-[min(6.3cqi,1.35rem)]"}`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const metricHeader = "px-4 py-3 text-end font-semibold whitespace-nowrap";
const metricValue = "px-4 py-4 text-end whitespace-nowrap tabular-nums";

function FinancialRows({ list }: { list: FinancialList }) {
  const { rows, preferences } = list;
  const amount = (value: string) => formatCurrency(value, preferences);
  const weight = t.weight(t.weightUnits[preferences.weightUnit]);

  return (
    <div
      role="region"
      aria-label={t.title}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card"
    >
      <table className="w-full min-w-226 text-start text-sm">
        <thead className="border-b border-border bg-muted/55 text-muted-foreground">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-start font-semibold whitespace-nowrap"
            >
              {t.name}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-start font-semibold whitespace-nowrap"
            >
              {t.contact}
            </th>
            <th scope="col" className={metricHeader}>
              {t.trucks}
            </th>
            <th scope="col" className={metricHeader}>
              {weight}
            </th>
            <th scope="col" className={metricHeader}>
              {t.sales}
            </th>
            <th scope="col" className={metricHeader}>
              {t.received}
            </th>
            <th scope="col" className={metricHeader}>
              {t.balance}
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-start font-semibold whitespace-nowrap"
            >
              {t.status}
            </th>
            <th scope="col" className="px-3 py-3">
              <span className="sr-only">{t.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const value = new Decimal(row.activity.balance);
            const exceeds =
              row.creditLimit !== null && value.gt(row.creditLimit);
            return (
              <tr key={row.id} className="align-top hover:bg-muted/30">
                <th scope="row" className="min-w-44 px-4 py-4 text-start">
                  <p className="[overflow-wrap:anywhere] font-semibold">
                    {row.name}
                  </p>
                  <p className="mt-1 text-xs font-normal text-muted-foreground">
                    {row.code}
                    {row.industry && ` · ${row.industry}`}
                  </p>
                </th>
                <td className="min-w-36 px-4 py-4">
                  {[row.contactPerson, row.phone, row.city]
                    .filter(Boolean)
                    .map((field, index) => (
                      <p
                        key={index}
                        className="[overflow-wrap:anywhere] leading-relaxed"
                      >
                        {field}
                      </p>
                    ))}
                </td>
                <td className={metricValue}>
                  {formatDecimal(
                    BigInt(row.activity.trucks),
                    0,
                    preferences.numberFormat,
                  )}
                </td>
                <td className={metricValue}>
                  {formatDecimal(
                    row.activity.weight,
                    3,
                    preferences.numberFormat,
                  )}
                </td>
                <td className={metricValue}>{amount(row.activity.billed)}</td>
                <td className={metricValue}>{amount(row.activity.settled)}</td>
                <td
                  className={`${metricValue} font-semibold ${value.gt(0) ? "text-negative" : value.lt(0) ? "text-positive" : ""}`}
                >
                  {amount(row.activity.balance)}
                  {exceeds && (
                    <p className="mt-1 text-xs font-medium text-warning">
                      {t.overLimit}
                    </p>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.isActive ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"}`}
                  >
                    {row.isActive ? t.active : t.inactive}
                  </span>
                </td>
                <td className="px-4 py-3 text-end">
                  <Link
                    href={`/customers/${row.id}`}
                    className="inline-flex min-h-9 items-center rounded-md px-2 font-semibold text-primary hover:underline"
                  >
                    {t.edit}
                    <span className="sr-only"> {row.name}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pageHref(filters: CustomerFilters, page: number) {
  const query = new URLSearchParams({ page: String(page) });
  if (filters.q) query.set("q", filters.q);
  if (filters.status !== "all") query.set("status", filters.status);
  return `/customers?${query}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.view")) notFound();
  const filters = readCustomerFilters(await searchParams);
  const list = await listCustomers(getDatabase(), actor, filters);
  const financial = list.mode === "financial";

  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t.title}</h1>
          <p>{financial ? t.description : t.directoryDescription}</p>
        </div>
        {financial && (
          <Button asChild>
            <Link href="/customers/new">
              <Plus size={17} aria-hidden="true" />
              {t.add}
            </Link>
          </Button>
        )}
      </header>
      <div className="grid gap-4">
        {financial && <Summary list={list} />}
        <FilterBar filters={filters} financial={financial} />
        <p className="text-sm text-muted-foreground">
          {t.customersFound(list.matchedCount)}
        </p>
        {list.rows.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-border bg-card px-5 py-8 text-muted-foreground">
            {financial && filters.status === "all" && !filters.q
              ? t.empty
              : t.noResults}
          </p>
        ) : list.mode === "financial" ? (
          <FinancialRows list={list} />
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
            {list.rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="[overflow-wrap:anywhere] font-semibold">
                  {row.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.code}
                </span>
              </li>
            ))}
          </ul>
        )}
        {list.lastPage > 1 && (
          <nav
            className="flex flex-wrap items-center justify-end gap-3 text-sm"
            aria-label={t.title}
          >
            <p className="text-muted-foreground">
              {t.page(list.page, list.lastPage)}
            </p>
            {list.page > 1 && (
              <Button asChild variant="outline">
                <Link href={pageHref(filters, list.page - 1)}>
                  {t.previous}
                </Link>
              </Button>
            )}
            {list.page < list.lastPage && (
              <Button asChild variant="outline">
                <Link href={pageHref(filters, list.page + 1)}>{t.next}</Link>
              </Button>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
