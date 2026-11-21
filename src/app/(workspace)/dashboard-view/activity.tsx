import Link from "next/link";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can, type PermissionActor } from "@/domain/permissions";
import { account } from "@/i18n/messages/account-en";
import { dashboard as t } from "@/i18n/messages/dashboard-en";
import { orders } from "@/i18n/messages/orders-en";
import type { readDashboard } from "@/server/dashboard/workspace";
import styles from "./dashboard.module.css";

type Dashboard = Awaited<ReturnType<typeof readDashboard>>;
type FinancialDashboard = Extract<Dashboard, { scope: "financial" }>;

function ActivityDate({ value, format }: { value: string; format: string }) {
  return (
    <time dateTime={value}>
      {formatDocumentDate(parseBusinessDate(value), format)}
    </time>
  );
}

export function RecentOrders({
  data,
  actor,
  reportHref,
}: {
  data: Dashboard;
  actor: PermissionActor;
  reportHref: string;
}) {
  const { recentOrders, preferences } = data;
  const mayPrint = can(actor.roleCode, "orders.print");
  return (
    <section className={styles.panel} aria-labelledby="recent-orders-heading">
      <div className={styles.panelHeading}>
        <h2 id="recent-orders-heading">{t.orders}</h2>
        {data.scope === "financial" && (
          <Link href={reportHref}>{t.viewReport}</Link>
        )}
      </div>
      {recentOrders.length ? (
        <div
          className={styles.dataScroll}
          tabIndex={0}
          role="region"
          aria-labelledby="recent-orders-heading"
        >
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">{t.orderNumber}</th>
                <th scope="col">{t.date}</th>
                <th scope="col">{t.customer}</th>
                <th scope="col">{t.vehicle}</th>
                <th scope="col">{t.weight}</th>
                <th scope="col">{t.status}</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id}>
                  <th scope="row">
                    {mayPrint ? (
                      <Link href={`/orders/${order.id}/slip`}>
                        {order.orderNo}
                      </Link>
                    ) : (
                      order.orderNo
                    )}
                  </th>
                  <td>
                    <ActivityDate
                      value={order.date}
                      format={preferences.dateFormat}
                    />
                  </td>
                  <td>{order.customerName}</td>
                  <td>{order.vehicleNo}</td>
                  <td>
                    {formatDecimal(order.weight, 3, preferences.numberFormat)}{" "}
                    {orders.weightUnits[preferences.weightUnit]}
                  </td>
                  <td>{orders.statuses[order.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>{t.emptyOrders}</p>
      )}
    </section>
  );
}

export function RecentTransactions({
  transactions,
  preferences,
}: Pick<FinancialDashboard, "transactions" | "preferences">) {
  if (!transactions) return null;

  return (
    <section className={styles.panel} aria-labelledby="recent-vouchers-heading">
      <div className={styles.panelHeading}>
        <h2 id="recent-vouchers-heading">{t.transactions}</h2>
        <Link href="/account">{t.viewAccount}</Link>
      </div>
      {transactions.length ? (
        <div
          className={styles.dataScroll}
          tabIndex={0}
          role="region"
          aria-labelledby="recent-vouchers-heading"
        >
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">{t.voucherNumber}</th>
                <th scope="col">{t.date}</th>
                <th scope="col">{t.party}</th>
                <th scope="col">{t.amount}</th>
                <th scope="col">{t.status}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((voucher) => (
                <tr key={voucher.id}>
                  <th scope="row">
                    <Link href={`/account/vouchers/${voucher.id}`}>
                      {voucher.voucherNo}
                    </Link>
                  </th>
                  <td>
                    <ActivityDate
                      value={voucher.date}
                      format={preferences.dateFormat}
                    />
                  </td>
                  <td>{voucher.partyName}</td>
                  <td>
                    {t.direction[voucher.direction]} ·{" "}
                    {formatCurrency(voucher.amount, preferences)}
                  </td>
                  <td>{account.statuses[voucher.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>{t.emptyTransactions}</p>
      )}
    </section>
  );
}
