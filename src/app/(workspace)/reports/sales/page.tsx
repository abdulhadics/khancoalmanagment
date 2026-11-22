import { FileDown, Printer, TableProperties } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SalesPartyFilter } from "@/components/workspace/sales-party-filter";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { salesDetailsMessages as common } from "@/i18n/messages/sales-details-en";
import { salesReportMessages as t } from "@/i18n/messages/sales-report-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { ReportPeriodError } from "@/server/reporting/period";
import {
  SalesFiltersError,
  salesPageSizes,
} from "@/server/reporting/sales-details";
import { readSalesPartyCatalogs } from "@/server/reporting/sales-party-options";
import {
  parseSalesReportFilters,
  readSalesReportPage,
  salesReportGroups,
  salesReportParameters,
  type SalesReportFilters,
} from "@/server/reporting/sales-report";
import { readDocumentDisplayPreferences } from "@/server/settings/company";

type Query = Record<string, string | string[] | undefined>;
type Report = Awaited<ReturnType<typeof readSalesReportPage>>;
type Preferences = Awaited<ReturnType<typeof readDocumentDisplayPreferences>>;

export const metadata = { title: t.title };

const input =
  "h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const cell = "px-4 py-3 align-middle";
const numberCell = `${cell} text-end whitespace-nowrap tabular-nums`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function Filters({
  filters,
  options,
  raw,
}: {
  filters: SalesReportFilters;
  options: Awaited<ReturnType<typeof readSalesPartyCatalogs>>;
  raw?: Query;
}) {
  const [customers, suppliers] = options;
  function value(field: "year" | "month" | "from" | "to" | "groupBy") {
    const supplied = raw?.[field];
    return typeof supplied === "string" ? supplied : (filters[field] ?? "");
  }
  return (
    <form
      action="/reports/sales"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Field label={common.year}>
        <input
          type="number"
          min="1000"
          max="9999"
          name="year"
          className={input}
          defaultValue={value("year")}
          placeholder={common.allYears}
        />
      </Field>
      <Field label={common.month}>
        <select name="month" className={input} defaultValue={value("month")}>
          <option value="">{common.allMonths}</option>
          {common.months.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </select>
      </Field>
      <Field label={common.from}>
        <input
          type="date"
          name="from"
          className={input}
          defaultValue={value("from")}
        />
      </Field>
      <Field label={common.to}>
        <input
          type="date"
          name="to"
          className={input}
          defaultValue={value("to")}
        />
      </Field>
      <SalesPartyFilter kind="customer" catalog={customers} className={input} />
      <SalesPartyFilter kind="supplier" catalog={suppliers} className={input} />
      <Field label={t.groupBy}>
        <select
          name="groupBy"
          className={input}
          defaultValue={value("groupBy")}
        >
          {salesReportGroups.map((group) => (
            <option key={group} value={group}>
              {t.groups[group]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={common.pageSize}>
        <select
          name="pageSize"
          className={input}
          defaultValue={filters.pageSize}
        >
          {salesPageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
        <Button type="submit">{common.filter}</Button>
        <Button asChild variant="ghost">
          <Link href="/reports/sales">{common.clear}</Link>
        </Button>
      </div>
    </form>
  );
}

function SalesTotalsList({
  report,
  prefs,
}: {
  report: Report;
  prefs: Preferences;
}) {
  const { trucks, weight, sales, purchases, profit } = report.totals;
  const stats = [
    [common.trucks, formatDecimal(BigInt(trucks), 0, prefs.numberFormat)],
    [
      common.columns.weight,
      `${formatDecimal(weight, 3, prefs.numberFormat)} ${common.units[prefs.weightUnit]}`,
    ],
    [common.sales, formatCurrency(sales, prefs)],
    [common.purchases, formatCurrency(purchases, prefs)],
    [common.columns.profit, formatCurrency(profit, prefs)],
  ] as const;
  return (
    <dl className="mb-4 grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-border bg-card sm:grid-cols-3 xl:grid-cols-5">
      {stats.map(([label, value]) => (
        <div
          className="@container min-w-0 border border-border p-3 sm:p-4"
          key={label}
        >
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd
            className={`mt-2 whitespace-nowrap font-semibold tabular-nums ${label === common.columns.profit ? (profit.startsWith("-") ? "text-destructive" : "text-positive") : ""}`}
            style={{ fontSize: `min(1.4rem, ${145 / value.length}cqi)` }}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SalesReportTable({
  report,
  prefs,
}: {
  report: Report;
  prefs: Preferences;
}) {
  const group = report.filters.groupBy;
  const byEntry = group === "entry";
  const quantity = (value: number) =>
    formatDecimal(BigInt(value), 0, prefs.numberFormat);
  const weight = (value: string) => formatDecimal(value, 3, prefs.numberFormat);
  const money = (value: string) => formatCurrency(value, prefs);

  function displayDate(value: string) {
    return (
      <time dateTime={value}>
        {formatDocumentDate(parseBusinessDate(value), prefs.dateFormat)}
      </time>
    );
  }

  function singlePartyHref(partyId: string) {
    const query = new URLSearchParams({ partyId });
    for (const field of ["year", "month", "from", "to"] as const) {
      const value = report.filters[field];
      if (value) query.set(field, value);
    }
    return `/reports/${group}?${query}`;
  }

  return (
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
      role="region"
      aria-label={t.title}
      tabIndex={0}
    >
      <table
        className={`w-full text-sm ${byEntry ? "min-w-[64rem]" : "min-w-[46rem]"}`}
      >
        <caption className="sr-only">{t.title}</caption>
        <thead className="border-b border-border bg-muted/65 text-muted-foreground">
          <tr>
            <th scope="col" className={`${cell} text-start font-semibold`}>
              {t.groupColumn[group]}
            </th>
            {byEntry &&
              [
                common.columns.businessDate,
                common.columns.customer,
                common.columns.supplier,
                common.columns.mine,
                common.columns.vehicleNo,
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={`${cell} text-start font-semibold`}
                >
                  {label}
                </th>
              ))}
            {[
              common.trucks,
              `${common.columns.weight} (${common.units[prefs.weightUnit]})`,
              common.sales,
              common.purchases,
              common.columns.profit,
            ].map((label) => (
              <th
                key={label}
                scope="col"
                className={`${numberCell} font-semibold`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {report.rows.map((row) => (
            <tr key={row.key} className="hover:bg-muted/30">
              <th
                scope="row"
                className={`${cell} text-start font-semibold [overflow-wrap:anywhere]`}
              >
                {group === "customer" || group === "supplier" ? (
                  <Link
                    className="text-primary hover:underline"
                    href={singlePartyHref(row.key)}
                    prefetch={false}
                  >
                    {row.label}
                  </Link>
                ) : group === "date" && row.businessDate ? (
                  displayDate(row.businessDate)
                ) : (
                  row.label
                )}
              </th>
              {byEntry && (
                <>
                  <td className={`${cell} whitespace-nowrap`}>
                    {row.businessDate && displayDate(row.businessDate)}
                  </td>
                  <td className={cell}>{row.customer}</td>
                  <td className={cell}>{row.supplier}</td>
                  <td className={cell}>{row.mine}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {row.vehicleNo}
                  </td>
                </>
              )}
              <td className={numberCell}>{quantity(row.trucks)}</td>
              <td className={numberCell}>{weight(row.weight)}</td>
              <td className={numberCell}>{money(row.sales)}</td>
              <td className={numberCell}>{money(row.purchases)}</td>
              <td
                className={`${numberCell} font-medium ${row.profit.startsWith("-") ? "text-destructive" : "text-positive"}`}
              >
                {money(row.profit)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/65 font-semibold">
          <tr>
            <th
              scope="row"
              colSpan={byEntry ? 6 : 1}
              className={`${cell} text-start`}
            >
              {t.grandTotal}
            </th>
            <td className={numberCell}>{quantity(report.totals.trucks)}</td>
            <td className={numberCell}>{weight(report.totals.weight)}</td>
            <td className={numberCell}>{money(report.totals.sales)}</td>
            <td className={numberCell}>{money(report.totals.purchases)}</td>
            <td className={numberCell}>{money(report.totals.profit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "reports.view")) notFound();
  const database = getDatabase();
  const raw = await searchParams;

  let report: Report | undefined;
  try {
    report = await readSalesReportPage(database, actor, raw);
  } catch (error) {
    if (!(
      error instanceof ReportPeriodError || error instanceof SalesFiltersError
    ))
      throw error;
  }
  const [options, prefs] = await Promise.all([
    readSalesPartyCatalogs(database, actor, report?.filters ?? raw),
    readDocumentDisplayPreferences(database),
  ]);
  const filters = report?.filters ?? parseSalesReportFilters();
  const parameters = salesReportParameters(filters);
  function pageHref(page: number) {
    const query = new URLSearchParams(parameters);
    query.set("page", String(page));
    return `/reports/sales?${query}`;
  }
  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        {report &&
          report.total > 0 &&
          can(actor.roleCode, "reports.export") && (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/reports/sales/export?format=csv&${parameters}`}>
                  <FileDown size={16} aria-hidden />
                  {common.exportCsv}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/reports/sales/export?format=pdf&${parameters}`}
                  target="_blank"
                  rel="noopener"
                >
                  <Printer size={16} aria-hidden />
                  {common.exportPdf}
                </a>
              </Button>
            </div>
          )}
      </header>
      {report && <SalesTotalsList report={report} prefs={prefs} />}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <div className="grid gap-3 p-4">
          {!report && (
            <p role="alert" className="text-sm text-destructive">
              {common.invalidFilters}
            </p>
          )}
          <Filters
            filters={filters}
            options={options}
            raw={report ? undefined : raw}
          />
        </div>
        {report && (
          <div className="border-t border-border">
            {report.rows.length ? (
              <SalesReportTable report={report} prefs={prefs} />
            ) : (
              <section className="grid justify-items-center gap-2 px-4 py-12 text-center">
                <TableProperties
                  className="text-muted-foreground"
                  size={24}
                  aria-hidden
                />
                <h2 className="font-semibold">{t.empty}</h2>
                <p className="text-sm text-muted-foreground">{t.emptyHelp}</p>
              </section>
            )}
            {report.total > 0 && (
              <nav
                aria-label={t.title}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm"
              >
                <p className="text-muted-foreground">
                  {t.page(report.page, report.pages, report.total)}
                </p>
                <div className="flex gap-2">
                  {report.page > 1 && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(report.page - 1)} prefetch={false}>
                        {common.previous}
                      </Link>
                    </Button>
                  )}
                  {report.page < report.pages && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(report.page + 1)} prefetch={false}>
                        {common.next}
                      </Link>
                    </Button>
                  )}
                </div>
              </nav>
            )}
          </div>
        )}
      </div>
    </>
  );
}
