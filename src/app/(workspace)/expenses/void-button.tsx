"use client";

import { useState, useTransition } from "react";
import { Ban, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { expenses as t } from "@/i18n/messages/expenses-en";
import { voidExpenseAction, type ActionState } from "./actions";

export function VoidButton({ expenseId }: { expenseId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [isPending, startTransition] = useTransition();

  const handleVoid = (formData: FormData) => {
    startTransition(async () => {
      const result = await voidExpenseAction({}, formData);
      if (result.success) {
        setIsOpen(false);
        setState({});
      } else {
        setState(result);
      }
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setState({});
          setIsOpen(true);
        }}
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        <Ban size={14} className="me-1" />
        {t.voidExpense}
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-semibold">{t.voidExpense}</h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <form action={handleVoid} className="space-y-4">
              <input type="hidden" name="expenseId" value={expenseId} />

              {state.error && (
                <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">
                  {t.errors[state.error as keyof typeof t.errors] ?? t.errors.save}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="reason" className="block text-sm font-medium">
                  {t.reason}
                </label>
                <input
                  id="reason"
                  name="reason"
                  type="text"
                  required
                  placeholder="Reason for voiding this expense"
                  className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
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
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {isPending ? "Voiding…" : t.voidExpense}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
