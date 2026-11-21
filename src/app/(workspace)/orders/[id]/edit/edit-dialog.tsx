"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { orders as t } from "@/i18n/messages/orders-en";

export function EditDispatchDialog({
  back,
  children,
}: {
  back: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="edit-dispatch-title"
      onCancel={(event) => {
        event.preventDefault();
        const dirty = dialog.current?.querySelector("form[data-dirty]");
        if (!dirty || window.confirm(t.discard)) router.push(back);
      }}
      className="fixed inset-0 m-auto max-h-[92dvh] w-[min(94vw,51rem)] overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-4 text-foreground backdrop:bg-slate-950/50 sm:p-6"
    >
      {children}
    </dialog>
  );
}
