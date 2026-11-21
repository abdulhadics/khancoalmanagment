import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { can, canAccessOrder } from "@/domain/permissions";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { orders as t } from "@/i18n/messages/orders-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  readDailyOrders,
  readDispatchOptions,
  readOrderForWorkspace,
} from "@/server/orders/workspace";
import { readDocumentDisplayPreferences } from "@/server/settings/company";
import { OrderGrid } from "./order-grid";

export const metadata = { title: t.title };

type Query = {
  date?: string | string[];
  page?: string | string[];
  duplicate?: string | string[];
  updated?: string | string[];
  customerId?: string | string[];
  supplierId?: string | string[];
};

function currentDate(value: Query["date"], fallback: string) {
  if (typeof value !== "string") return fallback;
  try {
    parseBusinessDate(value);
    return value;
  } catch {
    return fallback;
  }
}

export default async function OrderEntryPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "orders.create")) notFound();
  const query = await searchParams;
  const today = todayBusinessDate();
  const dateLocked = actor.roleCode === "OPERATOR";
  const date = dateLocked ? today : currentDate(query.date, today);
  const rawPage = typeof query.page === "string" ? Number(query.page) : 1;
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const financial = can(actor.roleCode, "orders.financial");
  const db = getDatabase();
  const [options, daily, preferences, source] = await Promise.all([
    readDispatchOptions(db, actor),
    readDailyOrders(db, actor, date, page),
    readDocumentDisplayPreferences(db),
    typeof query.duplicate === "string"
      ? readOrderForWorkspace(db, actor, query.duplicate)
      : null,
  ]);
  const chosenCustomer = options.customers.find(
    ({ id }) => id === query.customerId,
  );
  const chosenSupplier = options.suppliers.find(
    ({ id }) => id === query.supplierId,
  );
  const initial = source
    ? {
        customerId: source.customerId,
        supplierId: source.supplierId,
        mineId: source.mineId,
        vehicleNo: source.vehicleNo,
        weight: source.weight,
        sellRate: source.sellRate,
        purchaseRate: source.purchaseRate ?? "",
        notes: source.notes,
      }
    : chosenCustomer || chosenSupplier
      ? {
          customerId: chosenCustomer?.id ?? "",
          supplierId: chosenSupplier?.id ?? "",
          mineId:
            chosenSupplier?.mines.find(({ isDefault }) => isDefault)?.id ?? "",
        }
      : undefined;
  const onlyDate = (pageNumber: number) =>
    `/orders?date=${date}&page=${pageNumber}#daily-orders`;
  const unit = t.weightUnits[preferences.weightUnit];
  const price = (amount?: string) =>
    amount === undefined ? "—" : formatCurrency(amount, preferences);
  const headers = [
    t.orderNo,
    t.fields.customerId,
    t.fields.supplierId,
    t.fields.mineId,
    t.fields.vehicleNo,
    `${t.fields.weight} (${unit})`,
    t.status,
    ...(financial ? [t.buyAmount] : []),
    t.sellAmount,
    ...(financial ? [t.profit] : []),
    t.actions,
  ];

  return (
    <>
      <header className="page-heading">
        <h1>{t.title}</h1>
        <p>{t.description}</p>
      </header>
      {query.updated === "1" && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-positive/5 p-3 text-sm text-positive"
        >
          {t.updated}
        </p>
      )}
      <OrderGrid
        key={
          source?.id ??
          `${date}:${chosenCustomer?.id ?? ""}:${chosenSupplier?.id ?? ""}`
        }
        initialDate={date > today ? today : date}
        firstKey={randomUUID()}
        dateLocked={dateLocked}
        financial={financial}
        managesParties={can(actor.roleCode, "parties.manage")}
        options={options}
        preferences={preferences}
        initial={initial}
      />
      <section
        id="daily-orders"
        aria-labelledby="daily-orders-title"
        className="mt-7 scroll-mt-4 rounded-[var(--radius)] border border-border bg-card"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div>
            <h2 id="daily-orders-title" className="text-lg font-semibold">
              {t.dateHeading}
            </h2>
            {!dateLocked && (
              <form
                method="get"
                action="/orders#daily-orders"
                className="mt-2 flex flex-wrap items-end gap-2"
              >
                <label className="grid gap-1 text-sm">
                  {t.date}
                  <input
                    type="date"
                    name="date"
                    defaultValue={date}
                    className="min-h-9 rounded-lg border border-border bg-card px-2"
                    required
                  />
                </label>
                <Button size="sm" type="submit" variant="outline">
                  {t.filter}
                </Button>
              </form>
            )}
          </div>
          <Button size="sm" variant="outline" asChild>
            <a
              href={`/orders/print?date=${date}`}
              target="_blank"
              rel="noreferrer"
            >
              {t.print}
            </a>
          </Button>
        </div>
        {daily.rows.length ? (
          <div
            role="region"
            aria-label={t.dateHeading}
            tabIndex={0}
            className="overflow-x-auto"
          >
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  {headers.map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="whitespace-nowrap px-3 py-3 text-start font-semibold"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap px-3 py-3 text-start font-semibold"
                    >
                      {row.orderNo}
                    </th>
                    <td className="px-3 py-3">{row.customer}</td>
                    <td className="px-3 py-3">{row.supplier}</td>
                    <td className="px-3 py-3">{row.mine}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.vehicleNo}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {formatDecimal(row.weight, 3, preferences.numberFormat)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={
                          row.status === "PENDING_PRICING"
                            ? "text-warning"
                            : "text-positive"
                        }
                      >
                        {t.statuses[row.status]}
                      </span>
                    </td>
                    {financial && (
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                        {price(row.buyAmount)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {price(row.sellAmount)}
                    </td>
                    {financial && (
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                        {price(row.profit)}
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 whitespace-nowrap font-medium text-primary">
                        {canAccessOrder(actor, "orders.print", row, today) && (
                          <a
                            href={`/orders/${row.id}/slip`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.slip}
                          </a>
                        )}
                        <Link href={`/orders/${row.id}/edit`}>{t.edit}</Link>
                        <Link href={`/orders?date=${date}&duplicate=${row.id}`}>
                          {t.duplicate}
                        </Link>
                        {can(actor.roleCode, "orders.void") && (
                          <Link
                            className="text-negative"
                            href={`/orders/${row.id}/edit?void=1`}
                          >
                            {t.void}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-5 text-muted-foreground">{t.empty}</p>
        )}
        {daily.pages > 1 && (
          <nav
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 text-sm"
            aria-label={t.dateHeading}
          >
            <span>{t.page(daily.page, daily.pages)}</span>
            <div className="flex gap-2">
              {daily.page > 1 && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={onlyDate(daily.page - 1)}>{t.previous}</Link>
                </Button>
              )}
              {daily.page < daily.pages && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={onlyDate(daily.page + 1)}>{t.next}</Link>
                </Button>
              )}
            </div>
          </nav>
        )}
      </section>
    </>
  );
}
