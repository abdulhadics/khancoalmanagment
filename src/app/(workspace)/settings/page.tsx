import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { auth } from "@/i18n/messages/auth-en";
import { requireActor } from "@/server/auth/request-context";

export default async function SettingsPage() {
  const actor = await requireActor();
  if (!can(actor.roleCode, "settings.manage")) notFound();
  return (
    <>
      <div className="page-heading">
        <h1>{messages.nav.settings}</h1>
      </div>
      <section className="module-empty">
        <h2>{auth.staffManagement}</h2>
        <Button variant="outline" asChild>
          <Link href="/settings/users">{auth.manageStaff}</Link>
        </Button>
      </section>
    </>
  );
}
