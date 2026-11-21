"use client";

import {
  createContext,
  useActionState,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { salesDetailsMessages as t } from "@/i18n/messages/sales-details-en";
import type { SalesVoidState } from "./actions";

const Selection = createContext<{
  selected: ReadonlySet<string>;
  total: number;
  update: (value: string | null, checked: boolean) => void;
} | null>(null);

export function SelectSalesOrder({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const selection = useContext(Selection);
  if (!selection) return null;
  return (
    <input
      type="checkbox"
      name="order"
      value={value}
      aria-label={label}
      checked={selection.selected.has(value)}
      onChange={(event) => selection.update(value, event.currentTarget.checked)}
    />
  );
}

export function SelectAllSalesOrders() {
  const selection = useContext(Selection);
  if (!selection) return null;
  const count = selection.selected.size;
  return (
    <input
      type="checkbox"
      aria-label={t.selectAll}
      checked={count === selection.total}
      ref={(input) => {
        if (input) input.indeterminate = count > 0 && count < selection.total;
      }}
      onChange={(event) => selection.update(null, event.currentTarget.checked)}
    />
  );
}

export function SalesBulkVoidForm({
  action,
  requestKey,
  choices,
  children,
}: {
  action: (state: SalesVoidState, data: FormData) => Promise<SalesVoidState>;
  requestKey: string;
  choices: readonly string[];
  children: ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  function update(value: string | null, checked: boolean) {
    const next = new Set(value === null ? (checked ? choices : []) : selected);
    if (value !== null) {
      if (checked) next.add(value);
      else next.delete(value);
    }
    setSelected(next);
    if (!next.size) setConfirming(false);
  }

  return (
    <form action={submit} aria-busy={pending}>
      <input type="hidden" name="key" value={requestKey} />
      <Selection.Provider value={{ selected, total: choices.length, update }}>
        {children}
      </Selection.Provider>
      <div className="grid gap-3 border-t border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t.selected(selected.size)}
          </p>
          <Button
            variant="outline"
            type="button"
            disabled={!selected.size || pending}
            onClick={() => setConfirming(true)}
            aria-expanded={confirming}
            aria-controls="bulk-sales-confirmation"
          >
            {t.bulkVoid}
          </Button>
        </div>
        {confirming && (
          <div
            id="bulk-sales-confirmation"
            className="grid gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3"
          >
            <p className="text-sm text-muted-foreground">{t.bulkPrompt}</p>
            <label className="grid gap-1.5 text-sm font-medium">
              {t.reason}
              <input
                name="reason"
                type="text"
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                className="h-10 rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                className="bg-destructive text-white hover:bg-destructive/85"
                disabled={pending}
              >
                {pending ? t.saving : t.confirm}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                {t.cancel}
              </Button>
            </div>
          </div>
        )}
        {state.error && (
          <p className="text-sm text-destructive" role="alert">
            {t.voidErrors[state.error]}
          </p>
        )}
      </div>
    </form>
  );
}
