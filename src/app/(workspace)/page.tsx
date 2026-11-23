import { Coins, Scale, Truck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { dashboard as t } from "@/i18n/messages/dashboard-en";
import { orders } from "@/i18n/messages/orders-en";
import { readLatestBackup } from "@/server/admin/backups";
import { requireActor } from "@/server/auth/request-context";
import {
  DashboardPeriodError,
  dashboardPeriods,
  readDashboard,
} from "@/server/dashboard/workspace";
import { getDatabase } from "@/server/db/client";
import { BackupStatus } from "./admin/backups/status";
import { RecentOrders, RecentTransactions } from "./dashboard-view/activity";
import { MonthlyChart } from "./dashboard-view/monthly-chart";
import styles from "./dashboard-view/dashboard.module.css";

type Dashboard = Awaited<ReturnType<typeof readDashboard>>;
type Query = Record<string, string | string[] | undefined>;

const summaryPeriods = ["today", "month", "year", "all"] as const;
const totalCards = [
  { key: "trucks", label: t.trucks, icon: Truck },
  { key: "weight", label: t.weight, icon: Scale },
  { key: "sales", label: t.sales, icon: Coins },
] as const;

function periodQuery(period: string, from?: string, to?: string) {
  const query = new URLSearchParams({ period });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return `/?${query}`;
}

function DateRange({ data }: { data: Dashboard }) {
  const { from, to } = data.bounds;
  const date = (key: string) =>
    formatDocumentDate(parseBusinessDate(key), data.preferences.dateFormat);
  const through = date(to);
  const label = !from
    ? t.allThrough.replace("{date}", through)
    : from === to
      ? through
      : t.range.replace("{from}", date(from)).replace("{to}", through);
  return <p className={styles.dateRange}>{label}</p>;
}

function SummaryCards({ data }: { data: Dashboard }) {
  const { preferences, totals } = data;
  const cards =
    data.scope === "financial" ? totalCards : totalCards.slice(0, 2);
  const weight = (value: string) =>
    `${formatDecimal(value, 3, preferences.numberFormat)} ${orders.weightUnits[preferences.weightUnit]}`;
  const format = (
    key: (typeof totalCards)[number]["key"],
    values: Dashboard["totals"],
  ) => {
    switch (key) {
      case "trucks":
        return formatDecimal(
          String(values.trucks),
          0,
          preferences.numberFormat,
        );
      case "weight":
        return weight(values.weight);
      case "sales":
        return "sales" in values
          ? formatCurrency(values.sales, preferences)
          : "";
    }
  };
  return (
    <dl className={styles.totals} aria-label={t.totals}>
      {cards.map(({ key, label, icon: Icon }) => (
        <div className={styles.total} key={key}>
          <dt className={styles.totalTitle}>
            {label}
            <Icon size={19} aria-hidden="true" />
          </dt>
          <dd className={styles.totalValue}>{format(key, totals)}</dd>
          {data.scope === "financial" && (
            <dd>
              <ul className={styles.comparison}>
                {summaryPeriods
                  .filter((period) => period !== data.period)
                  .map((period) => (
                    <li key={period}>
                      <span>{t.periods[period]}</span>
                      <strong>{format(key, data.summary[period])}</strong>
                    </li>
                  ))}
              </ul>
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function FinancialPanels({
  data,
}: {
  data: Extract<Dashboard, { scope: "financial" }>;
}) {
  const { companies, cash, balances, preferences, totals } = data;
  const money = (value: string) => formatCurrency(value, preferences);
  const metrics = [
    {
      label: t.companies,
      value: t.companyCount
        .replace(
          "{active}",
          formatDecimal(String(companies.active), 0, preferences.numberFormat),
        )
        .replace(
          "{total}",
          formatDecimal(String(companies.total), 0, preferences.numberFormat),
        ),
    },
    { label: t.cashOut, value: money(cash.paid), hint: t.cashOutDetail },
    { label: t.inHand, value: money(cash.balanceInHand), hint: t.inHandDetail },
    { label: t.purchases, value: money(totals.purchases) },
    { label: t.profit, value: money(totals.profit), hint: "Gross profit" },
    { label: "Expenses", value: money(data.expenses), hint: "Operational costs" },
    { label: "Net Profit", value: money(data.netProfit), hint: "Sales profit minus expenses" },
  ];
  return (
    <>
      <dl className={styles.indicators}>
        {metrics.map(({ label, value, hint }) => (
          <div className={styles.indicator} key={label}>
            <dt>{label}</dt>
            <dd className={styles.indicatorValue}>{value}</dd>
            {hint && (
              <dd>
                <small>{hint}</small>
              </dd>
            )}
          </div>
        ))}
      </dl>
      <div className={styles.financialPanels}>
        <MonthlyChart rows={data.monthly} preferences={preferences} />
        <section className={styles.panel} aria-labelledby="balances-heading">
          <div className={styles.panelHeading}>
            <h2 id="balances-heading">{t.balances}</h2>
          </div>
          <dl className={styles.balanceList}>
            <div>
              <dt>{t.receivable}</dt>
              <dd>{money(balances.receivable)}</dd>
            </div>
            <div>
              <dt>{t.payable}</dt>
              <dd>{money(balances.payable)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const [actor, query] = await Promise.all([requireActor(), searchParams]);
  const database = getDatabase();
  const field = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;
  const filters = {
    period: field("period"),
    from: field("from"),
    to: field("to"),
  };
  const [{ data, invalid }, latestBackup] = await Promise.all([
    readDashboard(database, actor, filters).then(
      (data) => ({ data, invalid: false }),
      async (error: unknown) => {
        if (!(error instanceof DashboardPeriodError)) throw error;
        return { data: await readDashboard(database, actor), invalid: true };
      },
    ),
    can(actor.roleCode, "admin.backups")
      ? readLatestBackup(database, actor)
      : null,
  ]);
  const { from, to } = data.bounds;
  const dateParams = new URLSearchParams({ to });
  if (from) dateParams.set("from", from);
  const showCustom =
    data.period === "custom" || (invalid && filters.period === "custom");

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1>{messages.nav.dashboard}</h1>
          <DateRange data={data} />
        </div>
        {data.scope === "financial" && (
          <nav className={styles.periods} aria-label={t.periodLabel}>
            {dashboardPeriods.map((period) => (
              <Link
                key={period}
                href={
                  period === "custom"
                    ? periodQuery(period, from ?? to, to)
                    : periodQuery(period)
                }
                aria-current={
                  (showCustom ? "custom" : data.period) === period
                    ? "page"
                    : undefined
                }
              >
                {t.periods[period]}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {showCustom && (
        <form
          action="/"
          className={styles.filterForm}
          aria-label={t.periods.custom}
        >
          <input type="hidden" name="period" value="custom" />
          <label>
            {t.from}
            <input
              type="date"
              name="from"
              required
              defaultValue={filters.from ?? from}
            />
          </label>
          <label>
            {t.to}
            <input
              type="date"
              name="to"
              required
              defaultValue={filters.to ?? to}
            />
          </label>
          <Button type="submit">{t.apply}</Button>
        </form>
      )}
      {invalid && (
        <p role="alert" className="text-sm text-negative">
          {t.invalid}
        </p>
      )}
      {latestBackup && <BackupStatus latest={latestBackup} showLink />}
      <SummaryCards data={data} />
      {data.scope === "financial" && <FinancialPanels data={data} />}
      <div className={styles.activity}>
        <RecentOrders
          data={data}
          actor={actor}
          reportHref={`/reports/sales?${dateParams}`}
        />
        {data.scope === "financial" && (
          <RecentTransactions
            transactions={data.transactions}
            preferences={data.preferences}
          />
        )}
      </div>
    </div>
  );
}
