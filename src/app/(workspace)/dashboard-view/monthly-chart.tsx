import type { CSSProperties } from "react";
import { formatCurrency } from "@/domain/number-display";
import { dashboard as t } from "@/i18n/messages/dashboard-en";
import type { SalesTotals } from "@/server/reporting/sales-facts";
import styles from "./dashboard.module.css";

const shortMonth = new Intl.DateTimeFormat("en-PK", {
  month: "short",
  timeZone: "Asia/Karachi",
});
const fullMonth = new Intl.DateTimeFormat("en-PK", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Karachi",
});
const measures = [
  { key: "sales", label: t.chartSales, style: styles.sales },
  { key: "purchases", label: t.chartPurchases, style: styles.purchase },
] as const;

export function MonthlyChart({
  rows,
  preferences,
}: {
  rows: readonly (SalesTotals & { month: string })[];
  preferences: { currencySymbol: string; numberFormat: string };
}) {
  const values = rows.flatMap(({ sales, purchases }) => [
    Number(sales),
    Number(purchases),
  ]);
  const maximum = Math.max(0, ...values);
  const minimum = Math.min(0, ...values);
  const range = maximum - minimum || 1;
  const baseline = (Math.abs(minimum) / range) * 100;
  const totals = rows.map((row) => ({
    ...row,
    date: new Date(`${row.month}-01T00:00:00Z`),
  }));

  return (
    <section className={styles.panel} aria-labelledby="monthly-heading">
      <div className={styles.panelHeading}>
        <h2 id="monthly-heading">{t.monthly}</h2>
        <p className={styles.legend}>
          {measures.map(({ key, label, style }) => (
            <span key={key}>
              <i className={style} aria-hidden="true" />
              {label}
            </span>
          ))}
        </p>
      </div>
      <div className={styles.chart} aria-hidden="true">
        <div
          className={styles.plot}
          style={{ "--baseline": `${baseline}%` } as CSSProperties}
        >
          {totals.map((row) => (
            <div key={row.month} className={styles.barPair}>
              {measures.map(({ key, label, style }) => {
                const value = Number(row[key]);
                const from = baseline + (Math.min(0, value) / range) * 100;
                const height = (Math.abs(value) / range) * 100;
                return (
                  <span
                    className={`${styles.bar} ${style}`}
                    key={key}
                    style={{ bottom: `${from}%`, height: `${height}%` }}
                    title={`${fullMonth.format(row.date)} · ${label} · ${formatCurrency(row[key], preferences)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className={styles.monthLabels}>
          {totals.map((row) => (
            <span key={row.month}>{shortMonth.format(row.date)}</span>
          ))}
        </div>
      </div>
      <details className={styles.chartData}>
        <summary>{t.chartData}</summary>
        <div className={styles.dataScroll} tabIndex={0}>
          <table className={styles.dataTable} aria-label={t.monthly}>
            <thead>
              <tr>
                <th scope="col">{t.chartMonth}</th>
                <th scope="col">{t.chartSales}</th>
                <th scope="col">{t.chartPurchases}</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{fullMonth.format(row.date)}</th>
                  <td>{formatCurrency(row.sales, preferences)}</td>
                  <td>{formatCurrency(row.purchases, preferences)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
