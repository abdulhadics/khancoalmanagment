import { CalendarDays, ChevronDown, CircleUserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import {
  destinations,
  permissionForDestination,
} from "@/components/workspace/navigation";
import { DesktopSidebar, MobileSidebar } from "@/components/workspace/sidebar";
import { formatBusinessDate } from "@/domain/business-date";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { auth } from "@/i18n/messages/auth-en";
import { requireActor } from "@/server/auth/request-context";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireActor();
  const today = formatBusinessDate(new Date());
  const allowedRoutes = destinations
    .filter(({ href }) => can(actor.roleCode, permissionForDestination(href)))
    .map(({ href }) => href);

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        {messages.common.skip}
      </a>
      <DesktopSidebar allowedRoutes={allowedRoutes} />
      <div className="workspace-body">
        <header className="workspace-toolbar">
          <MobileSidebar allowedRoutes={allowedRoutes} />
          <span className="workspace-label">{messages.common.workspace}</span>
          <span className="workspace-date">
            <CalendarDays aria-hidden="true" size={17} />
            {today}
          </span>
          <details className="account-menu">
            <summary aria-label={auth.profile}>
              <CircleUserRound aria-hidden="true" size={21} />
              <span>{actor.displayName}</span>
              <ChevronDown aria-hidden="true" size={15} />
            </summary>
            <div className="account-menu-content">
              <Link href="/profile">{auth.profile}</Link>
              <form action={signOut}>
                <button type="submit">{auth.signOut}</button>
              </form>
            </div>
          </details>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
}
