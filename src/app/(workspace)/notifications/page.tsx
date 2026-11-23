import { AlertCircle, Bell, Check, Clock, PackageCheck, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/domain/permissions";
import { notifications as t } from "@/i18n/messages/notifications-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { readNotificationsList } from "@/server/notifications/queries";
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "./actions";

export default async function NotificationsPage() {
  const actor = await requireActor();
  requirePermission(actor, "notifications.view");

  const database = getDatabase();
  const list = await readNotificationsList(database, actor);

  const iconForType = (type: string) => {
    switch (type) {
      case "CUSTOMER_OVERDUE":
        return <AlertCircle size={20} className="text-amber-500" />;
      case "SUPPLIER_OVERDUE":
        return <Clock size={20} className="text-red-500" />;
      case "DELIVERY_PENDING":
        return <PackageCheck size={20} className="text-blue-500" />;
      default:
        return <Bell size={20} className="text-primary" />;
    }
  };

  const linkForType = (item: (typeof list)[number]) => {
    if (item.type === "CUSTOMER_OVERDUE" && item.customerId) {
      return `/customers/${item.customerId}`;
    }
    if (item.type === "SUPPLIER_OVERDUE" && item.supplierId) {
      return `/suppliers/${item.supplierId}`;
    }
    if (item.type === "DELIVERY_PENDING") {
      return "/deliveries";
    }
    return null;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        <form action={markAllNotificationsReadAction}>
          <Button variant="outline" size="sm" type="submit" className="flex items-center gap-1.5">
            <Check size={15} />
            <span>{t.markAllRead}</span>
          </Button>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm divide-y divide-border overflow-hidden">
        {list.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            {t.noNotifications}
          </div>
        ) : (
          list.map((item) => {
            const targetLink = linkForType(item);
            return (
              <div
                key={item.id}
                className={`p-4 sm:p-5 flex items-start justify-between gap-4 transition-colors ${
                  item.isRead ? "bg-card" : "bg-primary/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-1">{iconForType(item.type)}</span>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.title}</span>
                      {!item.isRead && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {item.message}
                    </p>
                    {targetLink && (
                      <div className="pt-1.5">
                        <Link
                          href={targetLink}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          View Related Ledger / Record →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {!item.isRead && (
                    <form
                      action={async () => {
                        "use server";
                        await markNotificationReadAction(item.id);
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        type="submit"
                        title={t.markRead}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        <Check size={14} className="me-1" />
                        {t.markRead}
                      </Button>
                    </form>
                  )}
                  <form
                    action={async () => {
                      "use server";
                      await dismissNotificationAction(item.id);
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      type="submit"
                      title={t.dismiss}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      <X size={14} className="me-1" />
                      {t.dismiss}
                    </Button>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
