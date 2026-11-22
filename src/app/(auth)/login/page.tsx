import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/auth/action-form";
import { IdentifierField } from "@/components/auth/fields";
import { Button } from "@/components/ui/button";
import { auth } from "@/i18n/messages/auth-en";
import { getCurrentActor } from "@/server/auth/request-context";
import { isDatabaseReady } from "@/server/db/readiness";
import { signIn } from "../actions";

export const metadata = { title: auth.heading };

export default async function LoginPage() {
  if (!(await isDatabaseReady())) {
    return (
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{auth.unavailableHeading}</h1>
        <p>{auth.unavailableHelp}</p>
        <form action="/login" method="get">
          <Button type="submit">{auth.retrySignIn}</Button>
        </form>
      </section>
    );
  }
  if (await getCurrentActor()) redirect("/");
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.heading}</h1>
      <p>{auth.signInHelp}</p>
      <ActionForm action={signIn} submit={auth.heading}>
        <IdentifierField />
        <label>
          {auth.password}
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            maxLength={256}
          />
        </label>
      </ActionForm>
      <Link className="auth-link" href="/forgot-password">
        {auth.forgot}
      </Link>
    </section>
  );
}
