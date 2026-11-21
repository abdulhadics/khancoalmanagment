import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/auth/action-form";
import { VerificationField } from "@/components/auth/fields";
import { auth } from "@/i18n/messages/auth-en";
import { readTotpSetup } from "@/server/auth/challenge-flows";
import { readChallengeCookie } from "@/server/auth/cookies";
import { parseAuthEncryptionKey } from "@/server/auth/totp";
import { readEnvironment } from "@/server/config/env";
import { getDatabase } from "@/server/db/client";
import { enrollTotp } from "../../actions";

export const metadata = { title: auth.enroll };

export default async function EnrollTotpPage() {
  const token = await readChallengeCookie();
  const configuredKey = readEnvironment().AUTH_ENCRYPTION_KEY;
  if (!token || !configuredKey) redirect("/login");
  const key = parseAuthEncryptionKey(configuredKey);
  const setup = await readTotpSetup(getDatabase(), token, key);
  if (!setup) redirect("/login");

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{auth.enroll}</h1>
      <p>{auth.enrollHelp}</p>
      <div className="auth-setup-key">
        <span>{auth.setupKey}</span>
        <code dir="ltr">{setup.secret}</code>
      </div>
      <ActionForm action={enrollTotp} submit={auth.submitCode}>
        <VerificationField />
      </ActionForm>
      <Link className="auth-link" href="/login">
        {auth.back}
      </Link>
    </section>
  );
}
