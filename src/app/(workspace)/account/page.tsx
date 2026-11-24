import { randomUUID } from "node:crypto";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  ReceiptText,
  UsersRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { account as t } from "@/i18n/messages/account-en";
import {
  readAccountFormCatalog,
  readAccountWorkspace,
  type AccountFilters,
} from "@/server/account/workspace";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { PaymentForm } from "./payment-form";
import { VoucherControls } from "./voucher-controls";

export const metadata = { title: t.title };

type Query = Record<string, string | string[] | undefined>;
type Workspace = Awaited<ReturnType<typeof readAccountWorkspace>>;
type PartyTable = Workspace["customers"];
const cell = "border-b border-border px-3 py-3 align-top";
const control =
  "min-h-9 max-w-full rounded-lg border border-border bg-card px-2 text-sm";
const filterLabel = "grid min-w-0 gap-1 text-sm font-medium";

function value(query: Query, field: string) {
  return typeof query[field] === "string" ? query[field] : "";
}

function selection<T extends string>(
  value: string,
  choices: readonly T[],
): T | undefined {
  return choices.includes(value as T) ? (value as T) : undefined;
}

function pageNumber(key: string) {
  const page = Number(key);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

function accountUrl(
  query: Query,
  replacement: Record<string, string>,
  hash: string,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...replacement })) {
    if (typeof value === "string" && value) params.set(key, value);
  }
  return `/account?${params}#${hash}`;
}

function otherFilters(query: Query, omit: string[]) {
  return Object.entries(query).map(([key, value]) =>
    typeof value === "string" && value && !omit.includes(key) ? (
      <input key={key} type="hidden" name={key} value={value} />
    ) : null,
  );
}

function Table({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="min-w-0 max-w-full overflow-x-auto"
      role="region"
      tabIndex={0}
      aria-label={label}
    >
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className={`${cell} whitespace-nowrap text-start font-semibold`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Pager({
  query,
  field,
  current,
  last,
  hash,
  label,
}: {
  query: Query;
  field: string;
  current: number;
  last: number;
  hash: string;
  label: string;
}) {
  if (last <= 1) return null;
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4 text-sm"
    >
      <span>{t.page(current, last)}</span>
      <div className="flex gap-2">
        {current > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link
              href={accountUrl(query, { [field]: String(current - 1) }, hash)}
            >
              {t.previous}
            </Link>
          </Button>
        )}
        {current < last && (
          <Button asChild variant="outline" size="sm">
            <Link
              href={accountUrl(query, { [field]: String(current + 1) }, hash)}
            >
              {t.next}
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}

function PartyBalances({
  receiving,
  data,
  query,
  money,
}: {
  receiving: boolean;
  data: PartyTable;
  query: Query;
  money: (input: string) => string;
}) {
  const label = receiving ? t.customers : t.suppliers;
  const prefix = receiving ? "customer" : "supplier";
  const id = `${prefix}-balances`;
  const action = receiving ? "receive" : "pay";
  const formId = receiving ? "customer-receipt" : "supplier-payment";
  const queryKeys = [`${prefix}Q`, `${prefix}Status`, `${prefix}Page`];
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="min-w-0 scroll-mt-4 rounded-[var(--radius)] border border-border bg-card"
    >
      <div className="border-b border-border p-4 sm:p-5">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {label}
        </h2>
        <form
          method="get"
          action={`/account#${id}`}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          {otherFilters(query, queryKeys)}
          <label className={filterLabel}>
            {t.search}
            <input
              name={queryKeys[0]}
              defaultValue={value(query, queryKeys[0])}
              className={control}
              maxLength={100}
            />
          </label>
          <label className={filterLabel}>
            <span>{t.status}</span>
            <select
              name={queryKeys[1]}
              defaultValue={value(query, queryKeys[1]) || "all"}
              className={control}
            >
              <option value="all">{t.all}</option>
              <option value="pending">{t.pending}</option>
              <option value="clear">{t.clear}</option>
            </select>
          </label>
          <Button size="sm" variant="outline" type="submit">
            {t.filters}
          </Button>
        </form>
      </div>
      {data.rows.length > 0 ? (
        <Table
          label={label}
          headers={[
            t.code,
            receiving ? t.customer : t.supplier,
            receiving ? t.billed : t.purchased,
            receiving ? t.settledIn : t.settledOut,
            t.balance,
            t.status,
            t.actions,
          ]}
        >
          {data.rows.map((row) => (
            <tr key={row.id}>
              <td className={`${cell} whitespace-nowrap text-muted-foreground`}>
                {row.code}
              </td>
              <th scope="row" className={`${cell} text-start font-semibold`}>
                {row.name}
              </th>
              <td className={`${cell} whitespace-nowrap tabular-nums`}>
                {money(row.billed)}
              </td>
              <td className={`${cell} whitespace-nowrap tabular-nums`}>
                {money(row.settled)}
              </td>
              <td
                className={`${cell} whitespace-nowrap font-semibold tabular-nums`}
              >
                {money(row.balance)}
              </td>
              <td className={cell}>
                <span
                  className={
                    !row.isActive
                      ? "text-muted-foreground"
                      : /^0(?:\.0+)?$/.test(row.pending)
                        ? "text-positive"
                        : "text-negative"
                  }
                >
                  {!row.isActive
                    ? t.inactive
                    : row.balance.startsWith("-")
                      ? t.advance
                      : /^0(?:\.0+)?$/.test(row.pending)
                        ? t.clear
                        : t.pending}
                </span>
              </td>
              <td className={cell}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/details/${prefix}s?partyId=${row.id}`}
                  >
                    {t.ledger}
                  </Link>
                  {row.isActive && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        href={accountUrl(query, { [action]: row.id }, formId)}
                      >
                        {receiving ? t.receive : t.pay}
                      </Link>
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t.noMatches}</p>
      )}
      <Pager
        query={query}
        field={queryKeys[2]}
        current={data.page}
        last={data.lastPage}
        hash={id}
        label={label}
      />
    </section>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "account.view")) notFound();
  const query = await searchParams;
  const filters: AccountFilters = {
    customers: {
      q: value(query, "customerQ"),
      page: pageNumber(value(query, "customerPage")),
      status: selection(value(query, "customerStatus"), [
        "all",
        "pending",
        "clear",
      ] as const),
    },
    suppliers: {
      q: value(query, "supplierQ"),
      page: pageNumber(value(query, "supplierPage")),
      status: selection(value(query, "supplierStatus"), [
        "all",
        "pending",
        "clear",
      ] as const),
    },
    vouchers: {
      q: value(query, "voucherQ"),
      page: pageNumber(value(query, "voucherPage")),
      direction: selection(value(query, "direction"), ["IN", "OUT"] as const),
      method: selection(
        value(query, "method"),
        Object.keys(t.methods) as (keyof typeof t.methods)[],
      ),
      status: selection(
        value(query, "status"),
        Object.keys(t.statuses) as (keyof typeof t.statuses)[],
      ),
      from: value(query, "from") || undefined,
      to: value(query, "to") || undefined,
    },
  };
  const db = getDatabase();
  const [workspace, { receipt, payment }] = await Promise.all([
    readAccountWorkspace(db, actor, filters),
    readAccountFormCatalog(db, actor),
  ]);
  const { asOf, summary, customers, suppliers, transactions, preferences } =
    workspace;
  const money = (amount: string) => formatCurrency(amount, preferences);
  const cards = [
    {
      label: t.received,
      value: money(summary.received),
      icon: ArrowDownToLine,
      color: "text-positive",
    },
    {
      label: t.paid,
      value: money(summary.paid),
      icon: ArrowUpFromLine,
      color: "text-warning",
    },
    {
      label: t.receivable,
      value: money(summary.receivable),
      icon: UsersRound,
      color: "text-negative",
    },
    {
      label: t.payable,
      value: money(summary.payable),
      icon: Banknote,
      color: "text-negative",
    },
    {
      label: t.cashBalance,
      value: money(summary.balanceInHand),
      icon: Wallet,
      color: "text-foreground",
    },
    {
      label: t.totalVouchers,
      value: formatDecimal(
        String(summary.voucherCount),
        0,
        preferences.numberFormat,
      ),
      icon: ReceiptText,
      color: "text-foreground",
    },
  ];
  const canVoid = can(actor.roleCode, "account.void");
  const voucherFilters = [
    "voucherQ",
    "voucherPage",
    "direction",
    "method",
    "status",
    "from",
    "to",
  ];
  const today = typeof asOf === "string" ? asOf : receipt.businessDate;

  return (
    <>
      <header className="page-heading">
        <h1>{t.title}</h1>
        <p>{t.description}</p>
      </header>
      <section aria-label={t.summary} className="mb-6">
        <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {cards.map(({ label, value, color, icon: Icon }) => (
            <div
              key={label}
              className="rounded-[var(--radius)] border border-border bg-card p-4"
            >
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon aria-hidden="true" size={17} />
                {label}
              </dt>
              <dd
                className={`mt-1 text-lg font-semibold tabular-nums ${color}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <span>
            {t.unclearedReceipts}{" "}
            <strong>{money(summary.unclearedReceived)}</strong>
          </span>
          <span>
            {t.unclearedPayments}{" "}
            <strong>{money(summary.unclearedPaid)}</strong>
          </span>
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <section
          id="customer-receipt"
          aria-label={t.receipt}
          className="scroll-mt-4 rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5"
        >
          <PaymentForm
            key={value(query, "receive")}
            direction="IN"
            options={receipt}
            preferences={preferences}
            initialKey={randomUUID()}
            initialParty={value(query, "receive")}
            managesBankAccounts={can(actor.roleCode, "settings.manage")}
          />
        </section>
        <section
          id="supplier-payment"
          aria-label={t.payment}
          className="scroll-mt-4 rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5"
        >
          <PaymentForm
            key={value(query, "pay")}
            direction="OUT"
            options={payment}
            preferences={preferences}
            initialKey={randomUUID()}
            initialParty={value(query, "pay")}
            managesBankAccounts={can(actor.roleCode, "settings.manage")}
          />
        </section>
      </div>
      <div className="mt-6 grid min-w-0 grid-cols-1 gap-4">
        <PartyBalances receiving query={query} data={customers} money={money} />
        <PartyBalances
          receiving={false}
          query={query}
          data={suppliers}
          money={money}
        />
      </div>
      <section
        id="account-transactions"
        aria-labelledby="transactions-heading"
        className="mt-6 scroll-mt-4 rounded-[var(--radius)] border border-border bg-card"
      >
        <div className="border-b border-border p-4 sm:p-5">
          <h2 id="transactions-heading" className="text-lg font-semibold">
            {t.transactions}
          </h2>
          <form
            action="/account#account-transactions"
            method="get"
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            {otherFilters(query, voucherFilters)}
            <label className={filterLabel}>
              {t.search}
              <input
                name="voucherQ"
                defaultValue={value(query, "voucherQ")}
                className={control}
                maxLength={100}
              />
            </label>
            <label className={filterLabel}>
              <span>{t.direction}</span>
              <select
                name="direction"
                defaultValue={value(query, "direction")}
                className={control}
              >
                <option value="">{t.all}</option>
                <option value="IN">{t.in}</option>
                <option value="OUT">{t.out}</option>
              </select>
            </label>
            <label className={filterLabel}>
              <span>{t.method}</span>
              <select
                name="method"
                defaultValue={value(query, "method")}
                className={control}
              >
                <option value="">{t.all}</option>
                {Object.entries(t.methods).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              <span>{t.status}</span>
              <select
                name="status"
                defaultValue={value(query, "status")}
                className={control}
              >
                <option value="">{t.all}</option>
                {Object.entries(t.statuses).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              {t.from}
              <input
                type="date"
                name="from"
                defaultValue={value(query, "from")}
                className={control}
              />
            </label>
            <label className={filterLabel}>
              {t.to}
              <input
                type="date"
                name="to"
                defaultValue={value(query, "to")}
                className={control}
              />
            </label>
            <Button size="sm" variant="outline" type="submit">
              {t.filters}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link
                href={accountUrl(
                  query,
                  Object.fromEntries(voucherFilters.map((key) => [key, ""])),
                  "account-transactions",
                )}
              >
                {t.reset}
              </Link>
            </Button>
          </form>
        </div>
        {transactions.rows.length > 0 ? (
          <Table
            label={t.transactions}
            headers={[
              t.date,
              t.voucher,
              t.direction,
              `${t.customer} / ${t.supplier}`,
              t.method,
              t.bank,
              t.reference,
              t.amount,
              t.status,
              t.actions,
            ]}
          >
            {transactions.rows.map((row) => (
              <tr key={row.id}>
                <td className={`${cell} whitespace-nowrap`}>
                  {formatDocumentDate(
                    parseBusinessDate(row.businessDate),
                    preferences.dateFormat,
                  )}
                </td>
                <th
                  scope="row"
                  className={`${cell} whitespace-nowrap text-start font-semibold`}
                >
                  {row.voucherNo}
                </th>
                <td className={cell}>
                  {row.direction === "IN" ? t.in : t.out}
                </td>
                <td className={cell}>
                  {row.partyName}
                  {row.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.notes}
                    </p>
                  )}
                </td>
                <td className={cell}>{t.methods[row.method]}</td>
                <td className={cell}>{row.bankName ?? "—"}</td>
                <td className={cell}>{row.referenceNo ?? "—"}</td>
                <td
                  className={`${cell} whitespace-nowrap font-semibold tabular-nums`}
                >
                  {money(row.amount)}
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  {t.statuses[row.status]}
                </td>
                <td className={cell}>
                  <div className="grid gap-2">
                    <a
                      className="whitespace-nowrap font-medium text-primary"
                      href={`/account/vouchers/${row.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t.openVoucher}
                    </a>
                    {row.method === "CHEQUE" &&
                      (row.status === "RECEIVED" ||
                        row.status === "DEPOSITED") && (
                        <VoucherControls
                          key={row.status}
                          id={row.id}
                          keyValue={randomUUID()}
                          kind="cheque"
                          status={row.status}
                          date={row.businessDate}
                          today={today}
                        />
                      )}
                    {canVoid &&
                      row.status !== "VOIDED" &&
                      row.status !== "BOUNCED" && (
                        <VoucherControls
                          id={row.id}
                          keyValue={randomUUID()}
                          kind="void"
                          status={row.status}
                          date={row.businessDate}
                          today={today}
                        />
                      )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t.noMatches}</p>
        )}
        <Pager
          query={query}
          field="voucherPage"
          current={transactions.page}
          last={transactions.lastPage}
          hash="account-transactions"
          label={t.transactions}
        />
      </section>
    </>
  );
}
