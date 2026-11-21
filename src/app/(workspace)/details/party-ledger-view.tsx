import { FileDown, Printer, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { ledgerMessages as t } from "@/i18n/messages/ledger-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  ledgerPageSizes,
  parsePartyLedgerFilters,
  readLedgerPartyChoices,
  readPartyLedger,
  type LedgerParty,
  type LedgerPartyIdentity,
  type LedgerTab,
  type PartyLedgerFilters,
} from "@/server/details/party-ledger";
import { ReportPeriodError } from "@/server/reporting/period";

type Query = Record<string, string | string[] | undefined>;
type Ledger = NonNullable<Awaited<ReturnType<typeof readPartyLedger>>>;
const fieldClass =
  "min-h-10 min-w-0 rounded-lg border border-border bg-card px-3 text-sm";
const numberCell = "px-3 py-3 text-end whitespace-nowrap tabular-nums";
const keys = [
  "partyId",
  "year",
  "month",
  "from",
  "to",
  "q",
  "tab",
  "sort",
  "page",
  "pageSize",
] as const;

function ledgerUrl(
  path: string,
  filters: PartyLedgerFilters,
  override: Partial<PartyLedgerFilters> & { format?: string } = {},
) {
  const effective = { ...filters, ...override };
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = effective[key];
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  if (override.format) {
    query.delete("page");
    query.delete("pageSize");
    query.set("format", override.format);
  }
  return `${path}?${query}`;
}

function FilterBar({
  path,
  kind,
  filters,
  parties,
}: {
  path: string;
  kind: LedgerParty;
  filters: PartyLedgerFilters;
  parties: LedgerPartyIdentity[];
}) {
  const labels = t.parties[kind];
  return (
    <form
      action={path}
      className="grid gap-4 rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5"
    >
      <input type="hidden" name="tab" value={filters.tab} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="ledger-party" className="text-sm font-semibold">
            {labels.label}
          </label>
          <select
            id="ledger-party"
            name="partyId"
            defaultValue={filters.partyId ?? ""}
            className={fieldClass}
          >
            <option value="">{labels.placeholder}</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name} · {party.code}
                {!party.isActive && ` (${t.accountInactive})`}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="ledger-search" className="text-sm font-semibold">
            {t.search}
          </label>
          <div className="relative">
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="ledger-search"
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={120}
              placeholder={t.searchPlaceholder}
              className={`${fieldClass} w-full ps-9 placeholder:text-muted-foreground`}
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(9rem,1.4fr)_6rem]">
        <LedgerInput
          id="year"
          label={t.year}
          value={filters.year}
          type="number"
          min={1000}
          max={9999}
        />
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="ledger-month" className="text-sm font-semibold">
            {t.month}
          </label>
          <select
            id="ledger-month"
            name="month"
            defaultValue={filters.month ? String(Number(filters.month)) : ""}
            className={fieldClass}
          >
            <option value="">{t.allMonths}</option>
            {t.months.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </div>
        <LedgerInput
          id="from"
          label={t.from}
          type="date"
          value={filters.from}
        />
        <LedgerInput id="to" label={t.to} type="date" value={filters.to} />
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="ledger-sort" className="text-sm font-semibold">
            {t.sort}
          </label>
          <select
            id="ledger-sort"
            name="sort"
            defaultValue={filters.sort}
            className={fieldClass}
          >
            {Object.entries(t.sorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="ledger-page-size" className="text-sm font-semibold">
            {t.pageSize}
          </label>
          <select
            id="ledger-page-size"
            name="pageSize"
            defaultValue={filters.pageSize}
            className={fieldClass}
          >
            {ledgerPageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{t.apply}</Button>
        <Button asChild variant="ghost">
          <Link
            href={
              filters.partyId
                ? `${path}?partyId=${encodeURIComponent(filters.partyId)}`
                : path
            }
          >
            {t.reset}
          </Link>
        </Button>
      </div>
    </form>
  );
}

function LedgerInput({
  id,
  label,
  value,
  ...attributes
}: {
  id: string;
  label: string;
  value?: string;
  type: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={`ledger-${id}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        {...attributes}
        id={`ledger-${id}`}
        name={id}
        defaultValue={value ?? ""}
        className={`${fieldClass} w-full min-w-0`}
      />
    </div>
  );
}

function LedgerSummary({
  ledger,
  kind,
}: {
  ledger: Ledger;
  kind: LedgerParty;
}) {
  const { summary, preferences } = ledger;
  const labels = t.parties[kind];
  const money = (amount: string) => formatCurrency(amount, preferences);
  const rows = [
    {
      label: t.weight(t.units[preferences.weightUnit]),
      value: formatDecimal(summary.weight, 3, preferences.numberFormat),
    },
    { label: labels.billed, value: money(summary.billed) },
    { label: labels.settled, value: money(summary.settled) },
    { label: labels.due, value: money(summary.pending) },
    {
      label: t.entryCount,
      value: formatDecimal(
        BigInt(summary.entryCount),
        0,
        preferences.numberFormat,
      ),
    },
  ];
  const balances: Array<{ label: string; value: string }> = [
    { label: t.open, value: money(summary.openingBalance) },
    { label: t.movement, value: money(summary.activity) },
    { label: t.close, value: money(summary.closingBalance) },
  ];
  if (summary.adjustments !== "0.00")
    balances.push({ label: t.adjustments, value: money(summary.adjustments) });
  if (summary.advance !== "0.00")
    balances.push({ label: t.advance, value: money(summary.advance) });

  return (
    <div className="grid gap-3">
      <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
        {rows.map(({ label, value }) => (
          <div
            key={label}
            className="@container min-w-0 rounded-[var(--radius)] border border-border bg-card p-4"
          >
            <dt className="text-sm font-medium text-muted-foreground">
              {label}
            </dt>
            <dd
              className={`mt-2 font-semibold tracking-tight whitespace-nowrap tabular-nums ${value.length > 23 ? "text-[min(4.4cqi,1.12rem)]" : "text-[min(6.3cqi,1.3rem)]"}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-3 rounded-[var(--radius)] bg-muted/65 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {balances.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LedgerTable({ ledger, kind }: { ledger: Ledger; kind: LedgerParty }) {
  const { rows, preferences } = ledger;
  const labels = t.parties[kind];
  const money = (value: string) => formatCurrency(value, preferences);
  const unit = t.units[preferences.weightUnit];
  const headers = [
    t.date,
    t.reference,
    t.type,
    labels.label,
    t.vehicleBank,
    t.mineReference,
    t.weight(unit),
    t.rate(unit),
    labels.debit,
    labels.credit,
    t.balance,
    t.actions,
  ];
  return (
    <div
      role="region"
      aria-label={labels.title}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card"
    >
      <table className="w-full min-w-[67rem] text-start text-sm">
        <caption className="sr-only">{labels.title}</caption>
        <thead className="border-b border-border bg-muted/55 text-muted-foreground">
          <tr>
            {headers.map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-3 font-semibold whitespace-nowrap ${index >= 6 && index <= 10 ? "text-end" : "text-start"}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-muted/30">
              <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                <time dateTime={row.businessDate}>
                  {formatDocumentDate(
                    parseBusinessDate(row.businessDate),
                    preferences.dateFormat,
                  )}
                </time>
              </td>
              <th
                scope="row"
                className="px-3 py-3 text-start font-semibold whitespace-nowrap"
              >
                {row.refNo ?? t.emptyCell}
              </th>
              <td className="px-3 py-3 whitespace-nowrap">
                {row.paymentMethod === "ADJUSTMENT"
                  ? t.activity.CUSTOMER_ADJUSTMENT
                  : t.activity[row.kind]}
                {row.isReversal && (
                  <p className="text-xs text-warning">{t.reversal}</p>
                )}
              </td>
              <td className="min-w-32 px-3 py-3 [overflow-wrap:anywhere]">
                {row.partyName}
              </td>
              <td className="px-3 py-3">{row.vehicleOrBank ?? t.emptyCell}</td>
              <td className="px-3 py-3">
                {row.mineOrReference ?? t.emptyCell}
              </td>
              <td className={numberCell}>
                {row.weight === null
                  ? t.emptyCell
                  : formatDecimal(row.weight, 3, preferences.numberFormat)}
              </td>
              <td className={numberCell}>
                {row.rate === null ? t.emptyCell : money(row.rate)}
              </td>
              <td className={numberCell}>{money(row.debit)}</td>
              <td className={numberCell}>{money(row.credit)}</td>
              <td className={`${numberCell} font-semibold`}>
                {money(row.balance)}
              </td>
              <td className="px-3 py-3 text-end">
                {row.canPrintOrder && row.orderId && (
                  <a
                    className="font-semibold text-primary hover:underline"
                    href={`/orders/${row.orderId}/slip`}
                  >
                    {t.slip}
                  </a>
                )}
                {row.paymentId && (
                  <a
                    className="font-semibold text-primary hover:underline"
                    href={`/account/vouchers/${row.paymentId}`}
                  >
                    {t.voucher}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function PartyLedgerView({
  kind,
  query,
}: {
  kind: LedgerParty;
  query: Query;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "details.view")) notFound();
  const path = `/details/${kind}s`;
  const labels = t.parties[kind];
  let filters: PartyLedgerFilters;
  let invalidPeriod = false;
  try {
    filters = parsePartyLedgerFilters(query);
  } catch (error) {
    if (!(error instanceof ReportPeriodError)) throw error;
    invalidPeriod = true;
    filters = parsePartyLedgerFilters({
      ...query,
      year: undefined,
      month: undefined,
      from: undefined,
      to: undefined,
    });
  }

  const { ledger, parties } = await getDatabase().$transaction(
    async (tx) => {
      const [ledger, parties] = await Promise.all([
        invalidPeriod ? null : readPartyLedger(tx, kind, filters),
        readLedgerPartyChoices(tx, kind),
      ]);
      return { ledger, parties };
    },
    { isolationLevel: "RepeatableRead" },
  );
  const exportsAllowed = can(actor.roleCode, "reports.export");
  const tabs = Object.entries(t.tabs) as [LedgerTab, string][];

  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-3">
        <h1>{labels.title}</h1>
        {ledger && exportsAllowed && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={ledgerUrl(`${path}/export`, filters, { format: "pdf" })}>
                <Printer size={16} aria-hidden="true" />
                {t.pdf}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={ledgerUrl(`${path}/export`, filters, { format: "csv" })}>
                <FileDown size={16} aria-hidden="true" />
                {t.csv}
              </a>
            </Button>
          </div>
        )}
      </header>
      <div className="grid gap-4">
        <FilterBar
          path={path}
          kind={kind}
          filters={filters}
          parties={parties}
        />
        {invalidPeriod ? (
          <p
            role="alert"
            className="rounded-lg border border-negative/25 bg-negative/5 p-4 text-sm text-negative"
          >
            {t.invalidPeriod}
          </p>
        ) : !ledger ? (
          <p className="rounded-[var(--radius)] border border-border bg-card p-5 text-muted-foreground">
            {filters.partyId ? t.notFound : t.selectPrompt}
          </p>
        ) : (
          <>
            <LedgerSummary ledger={ledger} kind={kind} />
            <nav aria-label={t.activityTabs} className="flex flex-wrap gap-2">
              {tabs.map(([tab, label]) => (
                <Button
                  asChild
                  key={tab}
                  variant={tab === filters.tab ? "default" : "outline"}
                >
                  <Link
                    aria-current={tab === filters.tab ? "page" : undefined}
                    href={ledgerUrl(path, filters, { tab, page: 1 })}
                  >
                    {label}
                  </Link>
                </Button>
              ))}
            </nav>
            {ledger.rows.length > 0 ? (
              <LedgerTable ledger={ledger} kind={kind} />
            ) : (
              <p className="rounded-[var(--radius)] border border-border bg-card p-5 text-muted-foreground">
                {t.noEntries}
              </p>
            )}
            <nav
              aria-label={t.pagination}
              className="flex flex-wrap items-center justify-end gap-3 text-sm"
            >
              <p className="text-muted-foreground">
                {t.page(ledger.page, ledger.lastPage, ledger.matchedCount)}
              </p>
              {ledger.page > 1 && (
                <Button variant="outline" asChild>
                  <Link
                    href={ledgerUrl(path, filters, { page: ledger.page - 1 })}
                  >
                    {t.previous}
                  </Link>
                </Button>
              )}
              {ledger.page < ledger.lastPage && (
                <Button variant="outline" asChild>
                  <Link
                    href={ledgerUrl(path, filters, { page: ledger.page + 1 })}
                  >
                    {t.next}
                  </Link>
                </Button>
              )}
            </nav>
          </>
        )}
      </div>
    </>
  );
}
