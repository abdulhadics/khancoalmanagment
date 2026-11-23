"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deliveries as t } from "@/i18n/messages/deliveries-en";
import { createDeliveryAction, type DeliveryActionState } from "./actions";

type CustomerOption = { id: string; name: string; code: string };

export function DeliveryForm({
  today,
  customers,
}: {
  today: string;
  customers: CustomerOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<DeliveryActionState>({});
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createDeliveryAction({}, formData);
      if (result.success) {
        setIsOpen(false);
        setState({});
        formRef.current?.reset();
      } else {
        setState(result);
      }
    });
  };

  return (
    <>
      <Button
        onClick={() => {
          setState({});
          setIsOpen(true);
        }}
        className="flex items-center gap-1.5"
      >
        <Plus size={16} aria-hidden="true" />
        <span>{t.newRecord}</span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-semibold">{t.newRecord}</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <form ref={formRef} action={handleSubmit} className="space-y-4">
              {state.error && (
                <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">
                  {t.errors[state.error as keyof typeof t.errors] ?? t.errors.save}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="customerId" className="block text-sm font-medium">
                  {t.customer}
                </label>
                <select
                  id="customerId"
                  name="customerId"
                  required
                  className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                >
                  <option value="">Select customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="businessDate" className="block text-sm font-medium">
                    {t.date}
                  </label>
                  <input
                    id="businessDate"
                    name="businessDate"
                    type="date"
                    required
                    defaultValue={today}
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="orderedWeight" className="block text-sm font-medium">
                    {t.orderedWeight} (TON)
                  </label>
                  <input
                    id="orderedWeight"
                    name="orderedWeight"
                    type="text"
                    required
                    placeholder="e.g. 50.000"
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="notes" className="block text-sm font-medium">
                  {t.notes}
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="Order or payment reference, terms of pickup"
                  className="w-full rounded-lg border border-border bg-card p-3 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t.saving : t.save}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
