"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { expenses as t } from "@/i18n/messages/expenses-en";
import { saveExpenseAction, type ActionState } from "./actions";

export function ExpenseForm({ today }: { today: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveExpenseAction({}, formData);
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
        <span>{t.recordExpense}</span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-semibold">{t.recordExpense}</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
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
                  <label htmlFor="category" className="block text-sm font-medium">
                    {t.category}
                  </label>
                  <select
                    id="category"
                    name="category"
                    required
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  >
                    {Object.entries(t.categories).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="amount" className="block text-sm font-medium">
                  {t.amount} (PKR)
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="text"
                  required
                  placeholder="e.g. 15000"
                  className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="description" className="block text-sm font-medium">
                  {t.descriptionLabel}
                </label>
                <input
                  id="description"
                  name="description"
                  type="text"
                  required
                  placeholder="e.g. Yard office rent for November, Tea & refreshments for staff"
                  className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="notes" className="block text-sm font-medium">
                  {t.notes}
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="Optional details or reference receipt"
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
                  {isPending ? t.saving : t.saveExpense}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
