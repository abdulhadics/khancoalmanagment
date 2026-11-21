"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { auth } from "@/i18n/messages/auth-en";

export type AuthActionState = {
  kind: "error" | "success";
  message: string;
} | null;

export function ActionForm({
  action,
  children,
  submit,
}: {
  action: (
    previous: AuthActionState,
    data: FormData,
  ) => Promise<AuthActionState>;
  children: ReactNode;
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form className="auth-form" action={formAction} aria-busy={pending}>
      {children}
      {state && (
        <p
          className={state.kind === "error" ? "auth-error" : "auth-success"}
          role={state.kind === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? auth.working : submit}
      </Button>
    </form>
  );
}
