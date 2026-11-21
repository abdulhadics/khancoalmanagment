"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { administration as t } from "@/i18n/messages/admin-en";
import { salesDetailsMessages } from "@/i18n/messages/sales-details-en";
import { savePeriodLock } from "./actions";

const input =
  "h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-invalid:border-negative";
const field = "grid min-w-0 gap-1.5 text-sm font-medium";

export function PeriodForm({ year }: { year: string }) {
  const [month, setMonth] = useState("");
  const [operation, setOperation] = useState("");
  const [reason, setReason] = useState("");
  const [result, submit, pending] = useActionState(savePeriodLock, null);
  const p = t.period;
  const invalid = (name: string) =>
    result?.status === "error" && result.fields?.includes(name);

  return (
    <form action={submit} className="grid gap-4">
      <input type="hidden" name="year" value={year} />
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <label className={field}>
          {p.scope}
          <select
            className={input}
            name="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            required
            aria-invalid={invalid("month")}
          >
            <option value="" disabled>
              {p.scope}
            </option>
            <option value="year">
              {p.wholeYear} {year}
            </option>
            {salesDetailsMessages.months.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, "0")}>
                {name} {year}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {p.operation}
          <select
            className={input}
            name="operation"
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
            required
            aria-invalid={invalid("operation")}
          >
            <option value="" disabled>
              {p.operation}
            </option>
            <option value="lock">{p.lock}</option>
            <option value="unlock">{p.unlock}</option>
          </select>
        </label>
        <label className={field}>
          {p.reason}
          <textarea
            className={`${input} h-auto resize-y py-2`}
            name="reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            aria-invalid={invalid("reason")}
            aria-describedby="period-reason-help"
          />
        </label>
        <p
          id="period-reason-help"
          className="-mt-2 text-sm text-muted-foreground"
        >
          {p.reasonHelp}
        </p>
        <Button type="submit" className="justify-self-start">
          {pending ? p.pending : p.submit}
        </Button>
      </fieldset>
      {result && (
        <p
          className={
            result.status === "error"
              ? "text-negative text-sm"
              : "text-positive text-sm"
          }
          role={result.status === "error" ? "alert" : "status"}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
