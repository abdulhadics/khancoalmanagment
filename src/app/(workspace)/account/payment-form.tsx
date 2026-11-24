"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/domain/number-display";
import type { PaymentDirection, PaymentMethod } from "@/generated/prisma/enums";
import { account as t } from "@/i18n/messages/account-en";
import type { PaymentFormOptions } from "@/server/account/workspace";
import { previewPartyBalance, recordPayment } from "./actions";
import type { PaymentFormState } from "./form-state";

type Preferences = { currencySymbol: string; numberFormat: string };
type Props = {
  direction: PaymentDirection;
  options: PaymentFormOptions;
  preferences: Preferences;
  initialKey: string;
  initialParty?: string;
  showHeading?: boolean;
  managesBankAccounts?: boolean;
};

const inputClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm aria-invalid:border-negative";
const label = "grid min-w-0 content-start gap-1 text-sm font-semibold";

export function PaymentForm(props: Props) {
  const [initialKey] = useState(props.initialKey);
  const [state, action, pending] = useActionState(
    recordPayment.bind(null, props.direction),
    {},
  );
  return (
    <>
      {state.saved && (
        <p
          className="mb-3 rounded-lg bg-positive/5 p-3 text-sm text-positive"
          role="status"
        >
          {t.saved}{" "}
          <Link
            className="font-semibold underline"
            href={`/account/vouchers/${state.saved.id}`}
            target="_blank"
            prefetch={false}
          >
            {t.openVoucher}
          </Link>
        </p>
      )}
      <PaymentDraft
        key={state.saved?.key ?? initialKey}
        {...props}
        requestKey={state.saved?.key ?? initialKey}
        state={state}
        action={action}
        pending={pending}
      />
    </>
  );
}

function PaymentDraft({
  direction,
  options,
  preferences,
  initialParty,
  showHeading = true,
  managesBankAccounts = false,
  requestKey,
  state,
  action,
  pending,
}: Props & {
  requestKey: string;
  state: PaymentFormState;
  action: (data: FormData) => void;
  pending: boolean;
}) {
  const receiving = direction === "IN";
  const [partyId, setPartyId] = useState(
    options.parties.some(({ id }) => id === initialParty) ? initialParty! : "",
  );
  const [date, setDate] = useState(options.businessDate);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [bank, setBank] = useState("");
  const [lookup, setLookup] = useState<{
    id: string;
    businessDate: string;
    attempt: number;
    balance: string | null;
  } | null>(null);
  const [balanceAttempt, setBalanceAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const bankRequired = method !== "ADJUSTMENT";
  const referenceRequired = bankRequired && method !== "CASH";
  const accounts = options.banks.filter(
    ({ category }) => category === (method === "CASH" ? "CASH" : "BANK"),
  );
  const selectedBank = accounts.some(({ id }) => id === bank)
    ? bank
    : accounts.length === 1
      ? accounts[0].id
      : "";
  const missingAccount = bankRequired && accounts.length === 0;
  const selected = options.parties.find(({ id }) => id === partyId);
  const catalogBalance =
    date === options.businessDate ? selected?.balance : undefined;
  const canPreview = Boolean(
    selected && date.length === 10 && date <= options.businessDate,
  );
  const currentLookup =
    lookup?.id === partyId &&
    lookup.businessDate === date &&
    lookup.attempt === balanceAttempt
      ? lookup
      : null;
  const balance = catalogBalance ?? currentLookup?.balance ?? undefined;
  const balanceUnavailable =
    canPreview && balance === undefined && Boolean(currentLookup);
  const issue = state.issue;
  const invalid = (field: string) => issue?.field === field || undefined;

  useEffect(() => {
    if (!canPreview || catalogBalance !== undefined) return;
    let current = true;
    const savePreview = (balance: string | null) => {
      if (current)
        setLookup({
          id: partyId,
          businessDate: date,
          attempt: balanceAttempt,
          balance,
        });
    };
    void previewPartyBalance(direction, partyId, date)
      .then((result) => savePreview(result?.balance ?? null))
      .catch(() => savePreview(null));
    return () => {
      current = false;
    };
  }, [balanceAttempt, canPreview, catalogBalance, date, direction, partyId]);

  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  return (
    <form
      method="post"
      aria-busy={pending}
      data-dirty={dirty || undefined}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="key" value={requestKey} readOnly />
      {showHeading && (
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wallet aria-hidden="true" size={20} className="text-primary" />
          {receiving ? t.receipt : t.payment}
        </h2>
      )}
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          <span>{receiving ? t.customer : t.supplier}</span>
          <select
            name="partyId"
            className={inputClass}
            value={partyId}
            aria-invalid={invalid("partyId")}
            required
            onChange={(event) => setPartyId(event.target.value)}
          >
            <option value="">
              {receiving ? t.selectCustomer : t.selectSupplier}
            </option>
            {options.parties.map(({ id, code, name }) => (
              <option key={id} value={id}>
                {name} · {code}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2">
          <span>
            {date === options.businessDate ? t.balance : t.datedBalance}
          </span>
          <strong className="tabular-nums" role="status">
            {balance !== undefined
              ? formatCurrency(balance, preferences)
              : !selected
                ? t.noParty
                : !canPreview
                  ? t.selectBalanceDate
                  : balanceUnavailable
                    ? t.balanceUnavailable
                    : t.loadingBalance}
          </strong>
          {balanceUnavailable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setBalanceAttempt((attempt) => attempt + 1)}
            >
              {t.retryBalance}
            </Button>
          )}
        </div>
        <label className={label}>
          <span>{t.method}</span>
          <select
            name="method"
            className={inputClass}
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {Object.entries(t.methods).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t.date}
          <input
            name="businessDate"
            type="date"
            className={inputClass}
            value={date}
            max={options.businessDate}
            required
            aria-invalid={invalid("businessDate")}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        {bankRequired && (
          <label className={label}>
            <span>{t.bank}</span>
            <select
              name="bankId"
              className={inputClass}
              value={selectedBank}
              required
              disabled={missingAccount}
              aria-invalid={invalid("bankId")}
              onChange={(event) => setBank(event.target.value)}
            >
              <option value="">{t.selectBank}</option>
              {accounts.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {missingAccount && (
          <p
            role="status"
            className="text-sm text-muted-foreground sm:col-span-2"
          >
            {method === "CASH" ? t.noCashAccount : t.noBank}{" "}
            {managesBankAccounts ? (
              <Link
                href="/settings#payment-accounts"
                className="font-semibold underline"
              >
                {t.openPaymentAccounts}
              </Link>
            ) : (
              t.askOwnerForPaymentAccount
            )}
          </p>
        )}
        <label className={label}>
          {t.amount}
          <input
            name="amount"
            className={inputClass}
            inputMode="decimal"
            maxLength={64}
            required
            aria-invalid={invalid("amount")}
          />
        </label>
        <label className={`${label} sm:col-span-2`}>
          {t.reference}
          <input
            name="referenceNo"
            className={inputClass}
            maxLength={100}
            required={referenceRequired}
            aria-invalid={invalid("referenceNo")}
          />
        </label>
        <label className={`${label} sm:col-span-2`}>
          {t.notes}
          <textarea
            name="notes"
            className={`${inputClass} py-2`}
            rows={2}
            maxLength={1500}
            required={method === "ADJUSTMENT"}
            aria-invalid={invalid("notes")}
          />
        </label>
        {issue?.code === "advance" && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="confirmAdvance" />
            {t.confirmAdvance}
          </label>
        )}
      </fieldset>
      {issue && (
        <p role="alert" className="text-sm text-negative">
          {t.errors[issue.code]}{" "}
          {issue.excess && t.excess(formatCurrency(issue.excess, preferences))}
        </p>
      )}
      <Button type="submit" disabled={pending || missingAccount}>
        {pending ? t.saving : receiving ? t.postReceipt : t.postPayment}
      </Button>
    </form>
  );
}
