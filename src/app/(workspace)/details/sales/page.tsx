import { randomUUID } from "node:crypto";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileDown,
  Printer,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SalesPartyFilter } from "@/components/workspace/sales-party-filter";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { salesDetailsMessages as t } from "@/i18n/messages/sales-details-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  parseSalesFilters,
  readSalesDetailsPage,
  salesFilterParameters,
  SalesFiltersError,
  salesPageSizes,
  salesSortColumns,
  type SalesFilters,
  type SalesSortColumn,
} from "@/server/reporting/sales-details";
import { ReportPeriodError } from "@/server/reporting/period";
import { readSalesPartyCatalogs } from "@/server/reporting/sales-party-options";
import { readDocumentDisplayPreferences } from "@/server/settings/company";
import { voidSalesOrders } from "./actions";
import {
  SalesBulkVoidForm,
  SelectAllSalesOrders,
  SelectSalesOrder,
} from "./bulk-void-form";

type Query = Record<string, string | string[] | undefined>;
type Data = Awaited<ReturnType<typeof readSalesDetailsPage>>;

export const metadata = { title: t.title };

const control =
  "h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const cell = "px-3 py-2.5 align-middle";
const numberCell = `${cell} text-end whitespace-nowrap tabular-nums`;
const numericColumns = new Set<SalesSortColumn>([
  "weight",
  "purchaseRate",
  "buyAmount",
  "sellRate",
  "sellAmount",
  "profit",
]);

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function SalesFiltersForm({
  filters,
  options,
  rejected,
}: {
  filters: SalesFilters;
  options: Awaited<ReturnType<typeof readSalesPartyCatalogs>>;
  rejected?: Query;
}) {
  const [customers, suppliers] = options;
  const displayed = { ...filters, ...rejected };
  const value = (field: keyof SalesFilters) =>
    typeof displayed[field] === "string" ? displayed[field] : undefined;
  return (
    <form
      action="/details/sales"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="direction" value={filters.direction} />
      <FilterField label={t.year}>
        <input
          className={control}
          name="year"
          type="number"
          inputMode="numeric"
          min="1000"
          max="9999"
          defaultValue={value("year")}
          placeholder={t.allYears}
        />
      </FilterField>
      <FilterField label={t.month}>
        <select
          className={control}
          name="month"
          defaultValue={value("month") ?? ""}
        >
          <option value="">{t.allMonths}</option>
          {t.months.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label={t.from}>
        <input
          className={control}
          name="from"
          type="date"
          defaultValue={value("from")}
        />
      </FilterField>
      <FilterField label={t.to}>
        <input
          className={control}
          name="to"
          type="date"
          defaultValue={value("to")}
        />
      </FilterField>
      <SalesPartyFilter
        kind="customer"
        catalog={customers}
        className={control}
      />
      <SalesPartyFilter
        kind="supplier"
        catalog={suppliers}
        className={control}
      />
      <FilterField label={t.search}>
        <input
          className={control}
          name="q"
          type="search"
          maxLength={120}
          defaultValue={value("q")}
          placeholder={t.searchPlaceholder}
        />
      </FilterField>
      <FilterField label={t.pageSize}>
        <select
          name="pageSize"
          className={control}
          defaultValue={filters.pageSize}
        >
          {salesPageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </FilterField>
      <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
        <Button type="submit">{t.filter}</Button>
        <Button variant="ghost" asChild>
          <Link href="/details/sales">{t.clear}</Link>
        </Button>
      </div>
    </form>
  );
}

function stat(label: string, value: string, emphasis = false) {
  return (
    <div
      key={label}
      className="@container min-w-0 border border-border p-3 sm:p-4"
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`mt-2 whitespace-nowrap tabular-nums font-semibold ${emphasis ? "text-positive" : ""}`}
        style={{ fontSize: `min(1.4rem, ${145 / value.length}cqi)` }}
      >
        {value}
      </dd>
    </div>
  );
}

function detailsHref(
  filters: SalesFilters,
  changes: Readonly<Record<string, string>>,
) {
  const params = salesFilterParameters(filters);
  for (const [name, value] of Object.entries(changes)) params.set(name, value);
  return `/details/sales?${params}`;
}

function SortHeading({
  column,
  filters,
  label,
}: {
  column: SalesSortColumn;
  filters: SalesFilters;
  label: string;
}) {
  const active = column === filters.sort;
  const asc = filters.direction === "asc";
  const direction = active && asc ? "desc" : "asc";
  const icon = active ? (asc ? ArrowUp : ArrowDown) : ArrowUpDown;
  const Icon = icon;
  const numeric = numericColumns.has(column);
  return (
    <th
      scope="col"
      aria-sort={active ? (asc ? "ascending" : "descending") : undefined}
      className={`${cell} font-semibold whitespace-nowrap ${numeric ? "text-end" : "text-start"}`}
    >
      <Link
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        href={detailsHref(filters, { sort: column, direction })}
        prefetch={false}
      >
        {label}
        <Icon size={12} aria-hidden />
      </Link>
    </th>
  );
}

function SalesTable({
  data,
  allowVoid,
  prefs,
}: {
  data: Data;
  allowVoid: boolean;
  prefs: Awaited<ReturnType<typeof readDocumentDisplayPreferences>>;
}) {
  const money = (value: string) => formatCurrency(value, prefs);
  const weight = (value: string) => formatDecimal(value, 3, prefs.numberFormat);
  return (
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={t.title}
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[74rem] text-sm">
        <caption className="sr-only">{t.title}</caption>
        <thead className="border-b border-border bg-muted/65 text-muted-foreground">
          <tr>
            {allowVoid && (
              <th scope="col" className={cell}>
                <SelectAllSalesOrders />
              </th>
            )}
            {salesSortColumns.map((column) => (
              <SortHeading
                key={column}
                column={column}
                filters={data.filters}
                label={
                  column === "weight"
                    ? `${t.columns.weight} (${t.units[prefs.weightUnit]})`
                    : t.columns[column]
                }
              />
            ))}
            <th scope="col" className={`${cell} text-start font-semibold`}>
              {t.actions}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/35">
              {allowVoid && (
                <td className={cell}>
                  <SelectSalesOrder
                    value={`${row.id}:${row.revisionNo}`}
                    label={t.select(row.orderNo)}
                  />
                </td>
              )}
              <th
                scope="row"
                className={`${cell} text-start font-semibold whitespace-nowrap`}
              >
                {row.orderNo}
              </th>
              <td className={`${cell} whitespace-nowrap`}>
                <time dateTime={row.businessDate}>
                  {formatDocumentDate(
                    parseBusinessDate(row.businessDate),
                    prefs.dateFormat,
                  )}
                </time>
              </td>
              <td className={`${cell} min-w-24 [overflow-wrap:anywhere]`}>
                {row.customer}
              </td>
              <td className={`${cell} min-w-24 [overflow-wrap:anywhere]`}>
                {row.supplier}
              </td>
              <td className={cell}>{row.mine}</td>
              <td className={`${cell} whitespace-nowrap`}>{row.vehicleNo}</td>
              <td className={numberCell}>{weight(row.weight)}</td>
              <td className={numberCell}>{money(row.purchaseRate)}</td>
              <td className={numberCell}>{money(row.buyAmount)}</td>
              <td className={numberCell}>{money(row.sellRate)}</td>
              <td className={numberCell}>{money(row.sellAmount)}</td>
              <td
                className={`${numberCell} font-medium ${row.profit.startsWith("-") ? "text-destructive" : "text-positive"}`}
              >
                {money(row.profit)}
              </td>
              <td className={cell}>
                <div className="flex min-w-28 flex-wrap gap-x-2 gap-y-1 text-xs font-medium text-primary">
                  <a
                    className="hover:underline"
                    href={`/orders/${row.id}/slip`}
                    target="_blank"
                    rel="noopener"
                  >
                    {t.slip}
                  </a>
                  <Link
                    className="hover:underline"
                    href={`/orders/${row.id}/edit`}
                    prefetch={false}
                  >
                    {t.edit}
                  </Link>
                  <Link
                    className="hover:underline"
                    href={`/orders?date=${row.businessDate}&duplicate=${row.id}`}
                    prefetch={false}
                  >
                    {t.duplicate}
                  </Link>
                  {allowVoid && (
                    <Link
                      className="text-destructive hover:underline"
                      href={`/orders/${row.id}/edit?void=1`}
                      prefetch={false}
                    >
                      {t.void}
                    </Link>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/65 font-semibold">
          <tr>
            <th
              scope="row"
              colSpan={allowVoid ? 7 : 6}
              className={`${cell} text-start`}
            >
              {t.totals}
            </th>
            <td className={numberCell}>{weight(data.totals.weight)}</td>
            <td />
            <td className={numberCell}>{money(data.totals.purchases)}</td>
            <td />
            <td className={numberCell}>{money(data.totals.sales)}</td>
            <td className={numberCell}>{money(data.totals.profit)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function SalesDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "details.view")) notFound();
  const allowVoid = can(actor.roleCode, "orders.void");
  const database = getDatabase();
  const query = await searchParams;
  let data: Data;
  try {
    data = await readSalesDetailsPage(database, actor, query);
  } catch (error) {
    if (!(
      error instanceof SalesFiltersError || error instanceof ReportPeriodError
    ))
      throw error;
    const options = await readSalesPartyCatalogs(database, actor, query);
    return (
      <>
        <header className="page-heading">
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </header>
        <section className="grid gap-3 rounded-[var(--radius)] border border-border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {t.invalidFilters}
          </p>
          <SalesFiltersForm
            filters={parseSalesFilters()}
            options={options}
            rejected={query}
          />
        </section>
      </>
    );
  }
  const [options, prefs] = await Promise.all([
    readSalesPartyCatalogs(database, actor, data.filters),
    readDocumentDisplayPreferences(database),
  ]);
  const money = (value: string) => formatCurrency(value, prefs);
  const quantity = (value: number) =>
    formatDecimal(BigInt(value), 0, prefs.numberFormat);
  const weight = `${formatDecimal(data.totals.weight, 3, prefs.numberFormat)} ${t.units[prefs.weightUnit]}`;
  const exportQuery = salesFilterParameters(data.filters);
  const returnQuery = new URLSearchParams(exportQuery);
  returnQuery.set("page", String(data.page));
  const voided = Number(query.voided);
  const bulkRequestKey = randomUUID();
  const table = <SalesTable data={data} allowVoid={allowVoid} prefs={prefs} />;

  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        {can(actor.roleCode, "reports.export") && data.total > 0 && (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/details/sales/export?format=csv&${exportQuery}`}>
                <FileDown size={16} aria-hidden />
                {t.exportCsv}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                target="_blank"
                rel="noopener"
                href={`/details/sales/export?format=pdf&${exportQuery}`}
              >
                <Printer size={16} aria-hidden />
                {t.exportPdf}
              </a>
            </Button>
          </div>
        )}
      </header>
      <dl className="mb-4 grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-border bg-card sm:grid-cols-3 2xl:grid-cols-6">
        {stat(t.orders, quantity(data.total))}
        {stat(t.trucks, quantity(data.totals.trucks))}
        {stat(t.columns.weight, weight)}
        {stat(t.sales, money(data.totals.sales))}
        {stat(t.purchases, money(data.totals.purchases))}
        {stat(
          t.columns.profit,
          money(data.totals.profit),
          !data.totals.profit.startsWith("-"),
        )}
      </dl>
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <div className="grid gap-3 p-4">
          {Number.isSafeInteger(voided) && voided > 0 && (
            <p role="status" className="text-sm text-positive">
              {t.voided(voided)}
            </p>
          )}
          <SalesFiltersForm filters={data.filters} options={options} />
        </div>
        <div className="border-t border-border">
          {data.rows.length > 0 ? (
            allowVoid ? (
              <SalesBulkVoidForm
                key={bulkRequestKey}
                requestKey={bulkRequestKey}
                choices={data.rows.map((row) => `${row.id}:${row.revisionNo}`)}
                action={voidSalesOrders.bind(null, returnQuery.toString())}
              >
                {table}
              </SalesBulkVoidForm>
            ) : (
              table
            )
          ) : (
            <section className="grid justify-items-center gap-2 px-4 py-12 text-center">
              <Truck size={26} className="text-muted-foreground" aria-hidden />
              <h2 className="font-semibold">{t.noOrders}</h2>
              <p className="text-sm text-muted-foreground">{t.noOrdersHelp}</p>
            </section>
          )}
        </div>
        {data.total > 0 && (
          <nav
            aria-label={t.title}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm"
          >
            <p className="text-muted-foreground">
              {t.page(data.page, data.pages, data.total)}
            </p>
            <div className="flex gap-2">
              {data.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    prefetch={false}
                    href={detailsHref(data.filters, {
                      page: String(data.page - 1),
                    })}
                  >
                    {t.previous}
                  </Link>
                </Button>
              )}
              {data.page < data.pages && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    prefetch={false}
                    href={detailsHref(data.filters, {
                      page: String(data.page + 1),
                    })}
                  >
                    {t.next}
                  </Link>
                </Button>
              )}
            </div>
          </nav>
        )}
      </div>
    </>
  );
}
