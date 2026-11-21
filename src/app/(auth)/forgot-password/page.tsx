import Link from "next/link";
import { ActionForm } from "@/components/auth/action-form";
import { IdentifierField } from "@/components/auth/fields";
import { auth } from "@/i18n/messages/auth-en";
import { forgotPassword } from "../actions";

export const metadata = { title: auth.recover };

export default function ForgotPasswordPage() {
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.recover}</h1>
      <p>{auth.recoverHelp}</p>
      <ActionForm action={forgotPassword} submit={auth.sendLink}>
        <IdentifierField />
      </ActionForm>
      <Link className="auth-link" href="/login">
        {auth.back}
      </Link>
    </section>
  );
}
