import {
  beginTotp,
  signOutAll,
  updateOwnPassword,
  updateOwnUsername,
} from "@/app/(auth)/actions";
import { ActionForm } from "@/components/auth/action-form";
import { NewPasswordFields } from "@/components/auth/fields";
import { Button } from "@/components/ui/button";
import { auth } from "@/i18n/messages/auth-en";
import { requireActor } from "@/server/auth/request-context";
import { readEnvironment } from "@/server/config/env";

export const metadata = { title: auth.profile };

function CurrentPassword() {
  return (
    <label>
      {auth.currentPassword}
      <input
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
      />
    </label>
  );
}

export default async function ProfilePage() {
  const actor = await requireActor();
  return (
    <>
      <div className="page-heading">
        <h1>{auth.profile}</h1>
        <p>
          {actor.displayName} · {auth.roles[actor.roleCode]}
        </p>
      </div>
      <div className="profile-sections">
        {actor.roleCode === "OWNER" && (
          <section className="module-empty" aria-labelledby="change-username">
            <h2 id="change-username">{auth.updateUsername}</h2>
            <ActionForm action={updateOwnUsername} submit={auth.saveUsername}>
              <label>
                {auth.username}
                <input
                  name="username"
                  defaultValue={actor.username}
                  autoComplete="username"
                  minLength={3}
                  maxLength={64}
                  required
                />
              </label>
              <CurrentPassword />
            </ActionForm>
          </section>
        )}
        <section className="module-empty" aria-labelledby="change-password">
          <h2 id="change-password">{auth.updatePassword}</h2>
          <ActionForm action={updateOwnPassword} submit={auth.savePassword}>
            <CurrentPassword />
            <NewPasswordFields />
          </ActionForm>
        </section>
        {readEnvironment().AUTH_ENCRYPTION_KEY && (
          <section className="module-empty" aria-labelledby="totp-settings">
            <h2 id="totp-settings">{auth.enroll}</h2>
            <ActionForm action={beginTotp} submit={auth.startSetup}>
              <CurrentPassword />
            </ActionForm>
          </section>
        )}
        <section className="module-empty" aria-labelledby="device-settings">
          <h2 id="device-settings">{auth.deviceSessions}</h2>
          <form action={signOutAll}>
            <Button variant="outline" type="submit">
              {auth.signOutAll}
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
