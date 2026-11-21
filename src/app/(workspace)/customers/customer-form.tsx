"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { customersMessages as t } from "@/i18n/messages/customers-en";
import type { readCustomer } from "@/server/customers";
import {
  createCustomerAction,
  updateCustomerAction,
  type CustomerFormState,
} from "./actions";

type SavedCustomer = NonNullable<Awaited<ReturnType<typeof readCustomer>>>;

const inputClass =
  "min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal aria-invalid:border-negative";
const fieldClass = "grid content-start gap-2 text-sm font-semibold";
const initialState: CustomerFormState = {};

function Field({
  name,
  label,
  hint,
  ...input
}: ComponentProps<"input"> & { name: string; label: string; hint?: string }) {
  const id = `customer-${name}`;
  const invalid = input["aria-invalid"] === true;
  const fieldErrors: Partial<Record<string, string>> = t.fieldErrors;
  const help = invalid ? (fieldErrors[name] ?? t.fieldInvalid) : hint;
  return (
    <div className={fieldClass}>
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        name={name}
        className={inputClass}
        aria-describedby={help ? `${id}-hint` : undefined}
      />
      {help && (
        <p
          id={`${id}-hint`}
          className={`text-xs leading-relaxed font-normal ${invalid ? "text-negative" : "text-muted-foreground"}`}
        >
          {help}
        </p>
      )}
    </div>
  );
}

export function CustomerForm({
  customer,
  openingDisplay,
  openingAllowed,
  today,
  requestKey,
}: {
  customer?: SavedCustomer;
  openingDisplay?: { amount: string; date: string };
  openingAllowed: boolean;
  today: string;
  requestKey: string;
}) {
  const submit = customer
    ? updateCustomerAction.bind(null, customer.id)
    : createCustomerAction;
  const [state, action, pending] = useActionState(submit, initialState);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const value = (key: string, previous?: string | null) =>
    state.values?.[key] ?? previous ?? "";
  const invalid = (key: string) => state.fields?.includes(key);

  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      className="grid gap-7 rounded-[var(--radius)] border border-border bg-card p-5 sm:p-7"
    >
      <input type="hidden" name="requestKey" value={requestKey} />
      {customer && (
        <input type="hidden" name="updatedAt" value={customer.updatedAt} />
      )}
      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-negative/25 bg-negative/5 px-4 py-3 text-sm text-negative"
        >
          {t.errors[state.error]}
        </p>
      )}
      <fieldset className="grid gap-4">
        <legend className="mb-4 text-base font-semibold">
          {t.businessDetails}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="name"
            label={t.name}
            required
            maxLength={160}
            defaultValue={value("name", customer?.name)}
            aria-invalid={invalid("name")}
          />
          <Field
            name="industry"
            label={t.industry}
            maxLength={120}
            defaultValue={value("industry", customer?.industry)}
            aria-invalid={invalid("industry")}
          />
          <Field
            name="contactPerson"
            label={t.contact}
            maxLength={120}
            defaultValue={value("contactPerson", customer?.contactPerson)}
            aria-invalid={invalid("contactPerson")}
          />
          <Field
            name="phone"
            label={t.phone}
            type="tel"
            maxLength={12}
            defaultValue={value("phone", customer?.phone)}
            aria-invalid={invalid("phone")}
            hint={t.phoneHint}
          />
          <Field
            name="email"
            label={t.email}
            type="email"
            maxLength={254}
            defaultValue={value("email", customer?.email)}
            aria-invalid={invalid("email")}
          />
          <Field
            name="city"
            label={t.city}
            maxLength={120}
            defaultValue={value("city", customer?.city)}
            aria-invalid={invalid("city")}
          />
          <Field
            name="address"
            label={t.address}
            maxLength={500}
            defaultValue={value("address", customer?.address)}
            aria-invalid={invalid("address")}
          />
          <div className={fieldClass}>
            <label htmlFor="customer-notes">{t.notes}</label>
            <textarea
              id="customer-notes"
              name="notes"
              maxLength={1500}
              rows={3}
              defaultValue={value("notes", customer?.notes)}
              aria-invalid={invalid("notes")}
              className={`${inputClass} resize-y py-2`}
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="grid gap-4">
        <legend className="mb-4 text-base font-semibold">
          {t.creditAndStatus}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="creditLimit"
            label={t.creditLimit}
            inputMode="decimal"
            maxLength={16}
            defaultValue={value("creditLimit", customer?.creditLimit)}
            aria-invalid={invalid("creditLimit")}
            hint={t.creditLimitHint}
          />
          <div className={fieldClass}>
            <label htmlFor="customer-status">{t.status}</label>
            <select
              id="customer-status"
              name="status"
              defaultValue={value(
                "status",
                customer?.isActive === false ? "inactive" : "active",
              )}
              className={inputClass}
              aria-invalid={invalid("isActive")}
              aria-describedby="customer-status-hint"
            >
              <option value="active">{t.active}</option>
              <option value="inactive">{t.inactive}</option>
            </select>
            <p
              id="customer-status-hint"
              className="text-xs leading-relaxed font-normal text-muted-foreground"
            >
              {t.inactiveHint}
            </p>
          </div>
          {openingAllowed && !customer?.opening && (
            <>
              <Field
                name="openingAmount"
                label={t.openingBalance}
                inputMode="decimal"
                maxLength={16}
                defaultValue={value("openingAmount")}
                aria-invalid={invalid("openingAmount")}
                hint={t.openingHint}
              />
              <Field
                name="openingDate"
                label={t.openingDate}
                type="date"
                max={today}
                defaultValue={value("openingDate", today)}
                aria-invalid={invalid("openingDate")}
              />
            </>
          )}
          {customer?.opening && openingDisplay && (
            <div className="col-span-full rounded-lg bg-muted/55 p-4 text-sm">
              <p className="font-semibold">{t.openingBalance}</p>
              <p className="mt-1 tabular-nums text-muted-foreground">
                {openingDisplay.amount} ·{" "}
                <time dateTime={customer.opening.date}>
                  {openingDisplay.date}
                </time>
              </p>
            </div>
          )}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? t.saving : customer ? t.save : t.create}
        </Button>
        <Button asChild variant="ghost">
          <Link
            href="/customers"
            onNavigate={(event) => {
              if (dirty && !window.confirm(t.discard)) event.preventDefault();
            }}
          >
            {t.cancel}
          </Link>
        </Button>
      </div>
    </form>
  );
}
