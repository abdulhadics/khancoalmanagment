import { FileDown, Printer, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReportPeriodFields } from "@/components/workspace/report-period-fields";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { ledgerMessages as common } from "@/i18n/messages/ledger-en";
import { partyReports as t } from "@/i18n/messages/party-reports-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  ledgerPageSizes,
  type LedgerParty,
} from "@/server/details/party-ledger";
import {
  parsePartySummaryFilters,
  readPartySummaryReport,
  type PartySummaryFilters,
  type PartySummaryMetrics,
  type PartySummaryRow,
} from "@/server/reporting/party-summary";
import { ReportPeriodError } from "@/server/reporting/period";

type Query = Record<string, string | string[] | undefined>;
type Report = Awaited<ReturnType<typeof readPartySummaryReport>>;
const field =
  "min-h-10 min-w-0 rounded-lg border border-border bg-card px-3 text-sm";
const numberCell = "px-3 py-3 text-end whitespace-nowrap tabular-nums";
const periodKeys = ["year", "month", "from", "to"] as const;

function reportUrl(
  path: string,
  filters: PartySummaryFilters,
  extra: { partyId?: string; page?: number; format?: "pdf" | "csv" } = {},
) {
  const query = new URLSearchParams();
  for (const key of periodKeys) if (filters[key]) query.set(key, filters[key]);
  if (extra.partyId) {
    query.set("partyId", extra.partyId);
  } else {
    if (filters.q) query.set("q", filters.q);
    if (extra.format) query.set("format", extra.format);
    else {
      query.set("page", String(extra.page ?? filters.page));
      query.set("pageSize", String(filters.pageSize));
    }
  }
  return `${path}?${query}`;
}

function SummaryFilters({
  path,
  filters,
}: {
  path: string;
  filters: PartySummaryFilters;
}) {
  return (
    <form
      action={path}
      className="grid gap-4 rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(0,1fr))_7rem]">
        <div className="col-span-2 grid min-w-0 gap-1.5 2xl:col-span-1">
          <label
            htmlFor="report-party-search"
            className="text-sm font-semibold"
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
              id="report-party-search"
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={120}
              placeholder={t.searchPlaceholder}
              className={`${field} w-full ps-9 placeholder:text-muted-foreground`}
            />
          </div>
        </div>
        <ReportPeriodFields prefix="report-party" fields={filters} />
        <div className="grid min-w-0 gap-1.5">
          <label
            htmlFor="report-party-page-size"
            className="text-sm font-semibold"
          >
            {common.pageSize}
          </label>
          <select
            id="report-party-page-size"
            name="pageSize"
            defaultValue={filters.pageSize}
            className={field}
          >
            {ledgerPageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{common.apply}</Button>
        <Button variant="ghost" asChild>
          <Link href={path}>{common.reset}</Link>
        </Button>
      </div>
    </form>
  );
}

function PartySummaryCards({
  kind,
  report,
}: {
  kind: LedgerParty;
  report: Report;
}) {
  const { totals, preferences } = report;
  const labels = t[kind];
  const money = (value: string) => formatCurrency(value, preferences);
  const items: Array<{ label: string; value: string }> = [
    { label: common.open, value: money(totals.openingBalance) },
    { label: labels.billed, value: money(totals.billed) },
    { label: labels.settled, value: money(totals.settled) },
    { label: labels.due, value: money(totals.pending) },
  ];
  if (totals.advance !== "0.00")
    items.push({ label: common.advance, value: money(totals.advance) });
  return (
    <dl
      className={`grid gap-3 sm:grid-cols-2 ${items.length === 5 ? "2xl:grid-cols-5" : "2xl:grid-cols-4"}`}
    >
      {items.map(({ label, value }) => (
        <div
          key={label}
          className="@container min-w-0 rounded-[var(--radius)] border border-border bg-card p-4"
        >
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd
            className={`mt-2 font-semibold tracking-tight whitespace-nowrap tabular-nums ${value.length > 23 ? "text-[min(4.4cqi,1.12rem)]" : "text-[min(6.3cqi,1.3rem)]"}`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryMetrics({
  values,
  preferences,
}: {
  values: PartySummaryMetrics;
  preferences: Report["preferences"];
}) {
  const amount = (value: string) => formatCurrency(value, preferences);
  return (
    <>
      <td className={numberCell}>
        {formatDecimal(BigInt(values.trucks), 0, preferences.numberFormat)}
      </td>
      <td className={numberCell}>
        {formatDecimal(values.weight, 3, preferences.numberFormat)}
      </td>
      <td className={numberCell}>{amount(values.openingBalance)}</td>
      <td className={numberCell}>{amount(values.billed)}</td>
      <td className={numberCell}>{amount(values.settled)}</td>
      <td className={numberCell}>{amount(values.adjustments)}</td>
      <td className={`${numberCell} font-semibold`}>
        {amount(values.closingBalance)}
      </td>
    </>
  );
}

function ReportRowActions({
  row,
  kind,
  filters,
  ledger,
  pay,
}: {
  row: PartySummaryRow;
  kind: LedgerParty;
  filters: PartySummaryFilters;
  ledger: boolean;
  pay: boolean;
}) {
  const customer = kind === "customer";
  const linkClass = "font-semibold text-primary hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-3 whitespace-nowrap">
      {ledger && (
        <Link
          className={linkClass}
          href={reportUrl(`/details/${kind}s`, filters, { partyId: row.id })}
        >
          {t.ledger}
        </Link>
      )}
      {pay && row.isActive && (
        <Link
          className={linkClass}
          href={`/account?${customer ? "receive" : "pay"}=${row.id}#${customer ? "customer-receipt" : "supplier-payment"}`}
        >
          {t[kind].action}
        </Link>
      )}
      <Link
        className={linkClass}
        href={reportUrl(`/reports/${kind}`, filters, { partyId: row.id })}
      >
        {t.view}
        <span className="sr-only"> {row.name}</span>
      </Link>
    </div>
  );
}

function SummaryTable({
  kind,
  report,
  ledger,
  pay,
}: {
  kind: LedgerParty;
  report: Report;
  ledger: boolean;
  pay: boolean;
}) {
  const labels = t[kind];
  const headers = [
    labels.entity,
    t.trucks,
    common.weight(common.units[report.preferences.weightUnit]),
    common.open,
    labels.billed,
    labels.settled,
    common.adjustments,
    common.close,
    common.actions,
  ];
  return (
    <div
      role="region"
      aria-label={labels.title}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card"
    >
      <table className="w-full min-w-[57rem] text-start text-sm">
        <caption className="sr-only">{labels.title}</caption>
        <thead className="border-b border-border bg-muted/55 text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={`px-3 py-3 font-semibold whitespace-nowrap ${index > 0 && index < headers.length - 1 ? "text-end" : "text-start"}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {report.rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-muted/30">
              <th scope="row" className="min-w-45 px-3 py-3 text-start">
                <p className="[overflow-wrap:anywhere] font-semibold">
                  {row.name}
                </p>
                <p className="mt-1 text-xs font-normal text-muted-foreground">
                  {row.code}
                  {!row.isActive && ` · ${common.accountInactive}`}
                </p>
              </th>
              <SummaryMetrics values={row} preferences={report.preferences} />
              <td className="px-3 py-3">
                <ReportRowActions
                  row={row}
                  kind={kind}
                  filters={report.filters}
                  ledger={ledger}
                  pay={pay}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/55 font-semibold">
          <tr>
            <th scope="row" className="px-3 py-3 text-start">
              {t.total}
            </th>
            <SummaryMetrics
              values={report.totals}
              preferences={report.preferences}
            />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export async function PartySummaryView({
  kind,
  query,
}: {
  kind: LedgerParty;
  query: Query;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "reports.view")) notFound();
  const path = `/reports/${kind}s`;
  const labels = t[kind];
  let invalidPeriod = false;
  let filters: PartySummaryFilters;
  try {
    filters = parsePartySummaryFilters(query);
  } catch (error) {
    if (!(error instanceof ReportPeriodError)) throw error;
    invalidPeriod = true;
    filters = parsePartySummaryFilters({
      ...query,
      year: undefined,
      month: undefined,
      from: undefined,
      to: undefined,
    });
  }

  const report = invalidPeriod
    ? null
    : await getDatabase().$transaction(
        (tx) => readPartySummaryReport(tx, kind, filters),
        { isolationLevel: "RepeatableRead" },
      );
  const exportsAllowed = can(actor.roleCode, "reports.export");

  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-3">
        <h1>{labels.title}</h1>
        {report && exportsAllowed && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={reportUrl(`${path}/export`, filters, { format: "pdf" })}>
                <Printer size={16} aria-hidden="true" />
                {common.pdf}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={reportUrl(`${path}/export`, filters, { format: "csv" })}>
                <FileDown size={16} aria-hidden="true" />
                {common.csv}
              </a>
            </Button>
          </div>
        )}
      </header>
      <div className="grid gap-4">
        <SummaryFilters path={path} filters={filters} />
        {report ? (
          <>
            <PartySummaryCards kind={kind} report={report} />
            {report.rows.length > 0 ? (
              <SummaryTable
                kind={kind}
                report={report}
                ledger={can(actor.roleCode, "details.view")}
                pay={can(actor.roleCode, "account.manage")}
              />
            ) : (
              <p className="rounded-[var(--radius)] border border-border bg-card p-5 text-muted-foreground">
                {t.noResults}
              </p>
            )}
            <nav
              aria-label={common.pagination}
              className="flex flex-wrap items-center justify-end gap-3 text-sm"
            >
              <p className="text-muted-foreground">
                {t.page(report.page, report.lastPage, report.matchedCount)}
              </p>
              {report.page > 1 && (
                <Button variant="outline" asChild>
                  <Link
                    href={reportUrl(path, filters, { page: report.page - 1 })}
                  >
                    {common.previous}
                  </Link>
                </Button>
              )}
              {report.page < report.lastPage && (
                <Button variant="outline" asChild>
                  <Link
                    href={reportUrl(path, filters, { page: report.page + 1 })}
                  >
                    {common.next}
                  </Link>
                </Button>
              )}
            </nav>
          </>
        ) : (
          <p
            role="alert"
            className="rounded-lg border border-negative/25 bg-negative/5 p-4 text-sm text-negative"
          >
            {common.invalidPeriod}
          </p>
        )}
      </div>
    </>
  );
}
