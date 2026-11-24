"use client";

import { Wallet } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { openReceiptForm } from "@/app/(workspace)/account/actions";
import { PaymentForm } from "@/app/(workspace)/account/payment-form";
import { Button } from "@/components/ui/button";
import { account as t } from "@/i18n/messages/account-en";

export function QuickReceive({
  managesBankAccounts,
}: {
  managesBankAccounts: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof openReceiptForm>
  > | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function close() {
    const dirty = dialog.current?.querySelector("form[data-dirty]");
    if (!dirty || window.confirm(t.discardReceipt)) dialog.current?.close();
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t.quickReceive}
        onClick={() => {
          dialog.current?.showModal();
          setResult(null);
          setError(false);
          start(async () => {
            try {
              setResult(await openReceiptForm());
            } catch {
              setError(true);
            }
          });
        }}
      >
        <Wallet aria-hidden="true" size={16} />
        <span className="hidden xl:inline">{t.quickReceive}</span>
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="quick-receive-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        className="fixed inset-0 m-auto max-h-[92dvh] w-[min(94vw,34rem)] overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-5 text-foreground backdrop:bg-slate-950/50"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="quick-receive-title" className="text-lg font-semibold">
            {t.quickReceive}
          </h2>
          <Button type="button" size="sm" variant="outline" onClick={close}>
            {t.close}
          </Button>
        </div>
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t.loading}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {t.errors.save}
          </p>
        )}
        {result && (
          <PaymentForm
            direction="IN"
            options={result.options}
            preferences={result.preferences}
            initialKey={result.key}
            showHeading={false}
            managesBankAccounts={managesBankAccounts}
          />
        )}
      </dialog>
    </>
  );
}
