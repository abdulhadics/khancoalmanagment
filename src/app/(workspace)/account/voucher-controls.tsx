"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { account as t } from "@/i18n/messages/account-en";
import { changeVoucher } from "./actions";

const fieldClass =
  "min-h-9 rounded-md border border-border bg-card px-2 text-sm";

export function VoucherControls({
  id,
  keyValue,
  kind,
  status,
  date,
  today,
}: {
  id: string;
  keyValue: string;
  kind: "cheque" | "void";
  status: PaymentStatus;
  date: string;
  today: string;
}) {
  const [key] = useState(keyValue);
  const [state, action, pending] = useActionState(
    changeVoucher.bind(null, id, kind),
    {},
  );
  const [target, setTarget] = useState(
    status === "RECEIVED" ? "DEPOSITED" : "CLEARED",
  );
  const voiding = kind === "void";
  return (
    <details className="min-w-44">
      <summary
        className={`cursor-pointer whitespace-nowrap font-medium ${voiding ? "text-negative" : "text-primary"}`}
      >
        {voiding ? t.voidVoucher : t.updateCheque}
      </summary>
      <form
        method="post"
        className="mt-2 grid gap-2 rounded-lg border border-border bg-card p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          startTransition(() => action(fields));
        }}
      >
        <input type="hidden" name="key" value={key} readOnly />
        {voiding ? null : status === "RECEIVED" ? (
          <input type="hidden" name="targetStatus" value="DEPOSITED" readOnly />
        ) : (
          <label className="grid gap-1 text-xs font-semibold">
            {t.status}
            <select
              name="targetStatus"
              className={fieldClass}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="CLEARED">{t.markCleared}</option>
              <option value="BOUNCED">{t.markBounced}</option>
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold">
          {t.date}
          <input
            type="date"
            name="businessDate"
            min={date}
            max={today}
            defaultValue={today}
            className={fieldClass}
            required
          />
        </label>
        {(voiding || target === "BOUNCED") && (
          <label className="grid gap-1 text-xs font-semibold">
            {t.reason}
            <textarea
              name="reason"
              required
              rows={2}
              maxLength={500}
              className={`${fieldClass} py-2`}
            />
          </label>
        )}
        {state.issue && (
          <p className="text-xs text-negative" role="alert">
            {t.errors[state.issue.code]}
          </p>
        )}
        {state.updated && (
          <p role="status" className="text-xs text-positive">
            {t.updated}
          </p>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={pending || state.updated}
          className={voiding ? "bg-negative hover:bg-negative/90" : undefined}
        >
          {pending
            ? t.saving
            : voiding
              ? t.voidVoucher
              : status === "RECEIVED"
                ? t.markDeposited
                : t.saveStatus}
        </Button>
      </form>
    </details>
  );
}
