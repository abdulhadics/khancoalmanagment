import Link from "next/link";
import { ActionForm } from "@/components/auth/action-form";
import { NewPasswordFields } from "@/components/auth/fields";
import { auth } from "@/i18n/messages/auth-en";
import { resetPassword } from "../actions";

export const metadata = { title: auth.recover };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.recover}</h1>
      {valid ? (
        <>
          <p>{auth.resetHelp}</p>
          <ActionForm action={resetPassword} submit={auth.savePassword}>
            <input type="hidden" name="token" value={token} />
            <NewPasswordFields />
          </ActionForm>
        </>
      ) : (
        <p>{auth.expired}</p>
      )}
      <Link className="auth-link" href="/login">
        {auth.back}
      </Link>
    </section>
  );
}
