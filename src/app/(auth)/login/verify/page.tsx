import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/auth/action-form";
import { VerificationField } from "@/components/auth/fields";
import { auth } from "@/i18n/messages/auth-en";
import { readChallengeCookie } from "@/server/auth/cookies";
import { verifyTotp } from "../../actions";

export const metadata = { title: auth.verify };

export default async function VerifyLoginPage() {
  if (!(await readChallengeCookie())) redirect("/login");
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.verify}</h1>
      <p>{auth.verifyHelp}</p>
      <ActionForm action={verifyTotp} submit={auth.submitCode}>
        <VerificationField />
      </ActionForm>
      <Link className="auth-link" href="/login">
        {auth.back}
      </Link>
    </section>
  );
}
