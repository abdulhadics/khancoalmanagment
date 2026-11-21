"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { staffMessages as t } from "@/i18n/messages/staff-en";
import type { StaffMember } from "@/server/auth/staff";
import {
  createStaffAction,
  resetStaffPasswordAction,
  updateStaffAccessAction,
  type StaffFormState,
} from "./actions";

const fieldClass =
  "min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-none aria-invalid:border-negative";
const initialState: StaffFormState = {};

function Field({
  label,
  help,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; help?: string }) {
  return (
    <div className="grid content-start gap-2 text-sm font-semibold">
      <label htmlFor={props.id}>{label}</label>
      <input
        {...props}
        className={`${fieldClass} ${className ?? ""}`}
        aria-describedby={help ? `${props.id}-help` : undefined}
      />
      {help && (
        <span
          id={`${props.id}-help`}
          className="text-xs leading-relaxed font-normal text-muted-foreground"
        >
          {help}
        </span>
      )}
    </div>
  );
}

function RoleField({
  initial,
  invalid,
}: {
  initial: string;
  invalid?: boolean;
}) {
  return (
    <div className="grid content-start gap-2 text-sm font-semibold">
      <label htmlFor="staff-role">{t.role}</label>
      <select
        id="staff-role"
        name="roleCode"
        required
        defaultValue={initial}
        aria-invalid={invalid}
        className={fieldClass}
      >
        {Object.entries(t.roleNames).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormError({ state }: { state: StaffFormState }) {
  return (
    state.error && (
      <p
        role="alert"
        className="rounded-lg border border-negative/25 bg-negative/5 px-4 py-3 text-sm font-medium text-negative"
      >
        {t.errors[state.error]}
      </p>
    )
  );
}

function TemporaryPassword({
  id,
  state,
}: {
  id: string;
  state: StaffFormState;
}) {
  return (
    <Field
      id={id}
      label={t.temporaryPassword}
      name="password"
      type="password"
      autoComplete="new-password"
      required
      minLength={15}
      maxLength={256}
      help={t.temporaryPasswordHelp}
      aria-invalid={state.fields?.includes("password")}
    />
  );
}

export function CreateStaffForm() {
  const [state, action, pending] = useActionState(
    createStaffAction,
    initialState,
  );
  return (
    <form
      action={action}
      className="grid gap-5 rounded-[var(--radius)] border border-border bg-card p-5 sm:p-7"
    >
      <FormError state={state} />
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        <Field
          id="staff-name"
          label={t.displayName}
          name="displayName"
          autoComplete="off"
          required
          maxLength={120}
          defaultValue={state.values?.displayName}
          aria-invalid={state.fields?.includes("displayName")}
        />
        <Field
          id="staff-email"
          label={t.email}
          name="email"
          type="email"
          autoComplete="off"
          required
          maxLength={254}
          defaultValue={state.values?.email}
          aria-invalid={state.fields?.includes("email")}
        />
        <Field
          id="staff-username"
          label={t.username}
          name="username"
          autoComplete="off"
          required
          minLength={3}
          maxLength={64}
          defaultValue={state.values?.username}
          aria-invalid={state.fields?.includes("username")}
          help={t.usernameHelp}
        />
        <RoleField
          initial={state.values?.roleCode ?? "OPERATOR"}
          invalid={state.fields?.includes("roleCode")}
        />
        <TemporaryPassword id="staff-password" state={state} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? t.saving : t.create}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/settings/users">{t.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}

export function StaffAccessForm({ member }: { member: StaffMember }) {
  const [state, action, pending] = useActionState(
    updateStaffAccessAction.bind(null, member.id),
    initialState,
  );
  return (
    <form
      action={action}
      className="grid justify-items-start gap-5 rounded-[var(--radius)] border border-border bg-card p-5 sm:p-7"
    >
      <div>
        <h2 className="font-semibold">{t.accountAccess}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t.accessHelp}
        </p>
      </div>
      <FormError state={state} />
      <div className="grid w-full gap-4 sm:grid-cols-2">
        <RoleField
          initial={state.values?.roleCode ?? member.roleCode}
          invalid={state.fields?.includes("roleCode")}
        />
        <div className="grid content-start gap-2 text-sm font-semibold">
          <label htmlFor="staff-status">{t.status}</label>
          <select
            id="staff-status"
            name="status"
            required
            defaultValue={
              state.values?.status ?? (member.isActive ? "active" : "disabled")
            }
            aria-invalid={state.fields?.includes("isActive")}
            className={fieldClass}
          >
            <option value="active">{t.active}</option>
            <option value="disabled">{t.disabled}</option>
          </select>
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t.saving : t.saveAccess}
      </Button>
    </form>
  );
}

export function StaffPasswordForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    resetStaffPasswordAction.bind(null, id),
    initialState,
  );
  return (
    <form
      action={action}
      className="grid justify-items-start gap-5 rounded-[var(--radius)] border border-border bg-card p-5 sm:p-7"
    >
      <div>
        <h2 className="font-semibold">{t.resetPassword}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t.resetHelp}
        </p>
      </div>
      <FormError state={state} />
      <TemporaryPassword id="reset-staff-password" state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? t.saving : t.resetPassword}
      </Button>
    </form>
  );
}
