import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/auth/action-form";
import { NewPasswordFields } from "@/components/auth/fields";
import { auth } from "@/i18n/messages/auth-en";
import { readChallengeCookie } from "@/server/auth/cookies";
import { forcePasswordChange } from "../../actions";

export const metadata = { title: auth.change };

export default async function ChangePasswordPage() {
  if (!(await readChallengeCookie())) redirect("/login");
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.change}</h1>
      <p>{auth.changeHelp}</p>
      <ActionForm action={forcePasswordChange} submit={auth.savePassword}>
        <NewPasswordFields />
      </ActionForm>
      <Link className="auth-link" href="/login">
        {auth.back}
      </Link>
    </section>
  );
}
