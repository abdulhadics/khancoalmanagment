import { CalendarDays, ChevronDown, CircleUserRound, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import {
  destinations,
  permissionForDestination,
} from "@/components/workspace/navigation";
import { DesktopSidebar, MobileSidebar } from "@/components/workspace/sidebar";
import { Button } from "@/components/ui/button";
import { QuickReceive } from "@/components/workspace/quick-receive";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { auth } from "@/i18n/messages/auth-en";
import { orders } from "@/i18n/messages/orders-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { readWorkspaceDate } from "@/server/settings/company";

import { NotificationBell } from "@/components/workspace/notification-bell";
import { ThemeToggle } from "@/components/workspace/theme-toggle";
import {
  readNotificationsList,
  readUnreadNotificationCount,
} from "@/server/notifications/queries";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireActor();
  const db = getDatabase();
  const [today, notifications, unreadCount] = await Promise.all([
    readWorkspaceDate(db),
    readNotificationsList(db, actor).catch(() => []),
    readUnreadNotificationCount(db, actor).catch(() => 0),
  ]);
  const allowedRoutes = destinations
    .filter(({ href }) => can(actor.roleCode, permissionForDestination(href)))
    .map(({ href }) => href);

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content" tabIndex={0}>
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
          {can(actor.roleCode, "account.manage") && <QuickReceive />}
          {can(actor.roleCode, "orders.create") && (
            <Button asChild size="sm">
              <Link href="/orders" aria-label={orders.newOrder}>
                <Plus aria-hidden="true" size={16} />
                <span className="hidden sm:inline">{orders.newOrder}</span>
              </Link>
            </Button>
          )}
          <NotificationBell
            initialNotifications={notifications}
            initialUnreadCount={unreadCount}
          />
          <ThemeToggle />
          <details className="account-menu">
            <summary aria-label={auth.profileMenu(actor.displayName)}>
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
