"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { suppliersMessages as t } from "@/i18n/messages/suppliers-en";
import type { SupplierAction, SupplierFormState } from "./actions";

const inputStyle =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";

function Field({
  state,
  name,
  label,
  initial = "",
  required = false,
  maxLength,
  type = "text",
  inputMode,
  errorFields = [name],
}: {
  state: SupplierFormState;
  name: string;
  label: string;
  initial?: string;
  required?: boolean;
  maxLength?: number;
  type?: string;
  inputMode?: "decimal" | "tel";
  errorFields?: readonly string[];
}) {
  return (
    <label className="grid content-start gap-1.5 text-sm font-medium">
      {label}
      <input
        className={inputStyle}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={state.values?.[name] ?? initial}
        required={required}
        maxLength={maxLength}
        aria-invalid={
          state.fields?.some((field) => errorFields.includes(field)) ||
          undefined
        }
      />
    </label>
  );
}

function ActiveField({
  state,
  initial,
}: {
  state: SupplierFormState;
  initial: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input
        name="active"
        type="checkbox"
        defaultChecked={state.values ? state.values.active === "on" : initial}
      />
      {t.active}
    </label>
  );
}

function SupplierActionForm({
  action,
  requestKey,
  submit,
  children,
}: {
  action: SupplierAction;
  requestKey: string;
  submit: string;
  children: (state: SupplierFormState) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form className="grid gap-5" action={formAction} aria-busy={pending}>
      <input type="hidden" value={requestKey} name="key" />
      {children(state)}
      {state.error && (
        <p
          className="rounded-md bg-destructive/8 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t.errors[state.error]}
        </p>
      )}
      <div>
        <Button disabled={pending} type="submit">
          {pending ? t.saving : submit}
        </Button>
      </div>
    </form>
  );
}

type InitialSupplier = Partial<
  Record<
    | "name"
    | "contactPerson"
    | "phone"
    | "email"
    | "city"
    | "region"
    | "address"
    | "notes",
    string | null
  >
> & { isActive?: boolean };

export function SupplierForm({
  action,
  requestKey,
  initial,
  today,
  allowOpening,
}: {
  action: SupplierAction;
  requestKey: string;
  initial?: InitialSupplier;
  today: string;
  allowOpening: boolean;
}) {
  return (
    <SupplierActionForm
      action={action}
      requestKey={requestKey}
      submit={initial ? t.save : t.create}
    >
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              state={state}
              name="name"
              label={t.supplier}
              initial={initial?.name ?? ""}
              required
              maxLength={160}
            />
            <Field
              state={state}
              name="contactPerson"
              label={t.contact}
              initial={initial?.contactPerson ?? ""}
              maxLength={120}
            />
            <Field
              state={state}
              name="phone"
              label={t.phone}
              type="tel"
              inputMode="tel"
              initial={initial?.phone ?? ""}
              maxLength={26}
            />
            <Field
              state={state}
              name="email"
              label={t.email}
              type="email"
              initial={initial?.email ?? ""}
              maxLength={254}
            />
            <Field
              state={state}
              name="city"
              label={t.city}
              initial={initial?.city ?? ""}
              maxLength={120}
            />
            <Field
              state={state}
              name="region"
              label={t.region}
              initial={initial?.region ?? ""}
              maxLength={120}
            />
            <Field
              state={state}
              name="address"
              label={t.address}
              initial={initial?.address ?? ""}
              maxLength={500}
            />
            <label className="grid gap-1.5 text-sm font-medium">
              {t.notes}
              <textarea
                className={inputStyle}
                name="notes"
                rows={3}
                maxLength={1500}
                defaultValue={state.values?.notes ?? initial?.notes ?? ""}
              />
            </label>
          </div>
          <ActiveField state={state} initial={initial?.isActive ?? true} />
          {!initial && (
            <fieldset className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <legend className="pr-3 text-sm font-semibold">
                {t.defaultMine}
              </legend>
              <Field
                state={state}
                name="mineCode"
                label={t.mineCode}
                maxLength={60}
                errorFields={["code"]}
              />
              <Field
                state={state}
                name="mineName"
                label={t.mineName}
                maxLength={160}
              />
            </fieldset>
          )}
          {allowOpening && !initial && (
            <fieldset className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <legend className="pr-3 text-sm font-semibold">
                {t.openingAmount}
              </legend>
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {t.openingHelp}
              </p>
              <Field
                state={state}
                name="openingAmount"
                label={t.openingAmount}
                inputMode="decimal"
                maxLength={64}
                errorFields={["amount"]}
              />
              <Field
                state={state}
                name="date"
                label={t.openingDate}
                type="date"
                initial={today}
              />
            </fieldset>
          )}
        </>
      )}
    </SupplierActionForm>
  );
}

export function MineForm({
  action,
  requestKey,
  initial,
}: {
  action: SupplierAction;
  requestKey: string;
  initial?: {
    code: string;
    name: string;
    isActive: boolean;
    isDefault: boolean;
  };
}) {
  return (
    <SupplierActionForm
      action={action}
      requestKey={requestKey}
      submit={initial ? t.save : t.addMine}
    >
      {(state) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              state={state}
              name="code"
              label={t.mineCode}
              initial={initial?.code}
              required
              maxLength={60}
            />
            <Field
              state={state}
              name="name"
              label={t.mineName}
              initial={initial?.name}
              required
              maxLength={160}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <ActiveField state={state} initial={initial?.isActive ?? true} />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                name="default"
                type="checkbox"
                defaultChecked={
                  state.values
                    ? state.values.default === "on"
                    : initial?.isDefault
                }
              />
              {t.makeDefault}
            </label>
          </div>
        </>
      )}
    </SupplierActionForm>
  );
}

export function OpeningCorrectionForm({
  action,
  requestKey,
  today,
}: {
  action: SupplierAction;
  requestKey: string;
  today: string;
}) {
  return (
    <SupplierActionForm
      action={action}
      requestKey={requestKey}
      submit={t.correction}
    >
      {(state) => (
        <>
          <p className="text-sm text-muted-foreground">{t.correctionHelp}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              state={state}
              name="amount"
              label={t.correctionAmount}
              inputMode="decimal"
              required
              maxLength={64}
            />
            <Field
              state={state}
              name="date"
              label={t.openingDate}
              type="date"
              initial={today}
              required
            />
          </div>
          <Field
            state={state}
            name="reason"
            label={t.reason}
            required
            maxLength={500}
          />
        </>
      )}
    </SupplierActionForm>
  );
}
