"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, Check, Clock, PackageCheck, X } from "lucide-react";
import Link from "next/link";
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(workspace)/notifications/actions";
import { Button } from "@/components/ui/button";
import type { NotificationItem } from "@/server/notifications/queries";

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationItem[];
  initialUnreadCount: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const menuRef = useRef<HTMLDivElement>(null);

  const [prevProps, setPrevProps] = useState({
    notifications: initialNotifications,
    unreadCount: initialUnreadCount,
  });

  if (
    prevProps.notifications !== initialNotifications ||
    prevProps.unreadCount !== initialUnreadCount
  ) {
    setPrevProps({
      notifications: initialNotifications,
      unreadCount: initialUnreadCount,
    });
    setItems(initialNotifications);
    setUnreadCount(initialUnreadCount);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleMarkRead = async (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    await markNotificationReadAction(id);
  };

  const handleDismiss = async (id: string) => {
    const item = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (item && !item.isRead) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    await dismissNotificationAction(id);
  };

  const handleMarkAllRead = async () => {
    setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    await markAllNotificationsReadAction();
  };

  const iconForType = (type: string) => {
    switch (type) {
      case "CUSTOMER_OVERDUE":
        return <AlertCircle size={16} className="text-amber-500" />;
      case "SUPPLIER_OVERDUE":
        return <Clock size={16} className="text-red-500" />;
      case "DELIVERY_PENDING":
        return <PackageCheck size={16} className="text-blue-500" />;
      default:
        return <Bell size={16} className="text-primary" />;
    }
  };

  const linkForType = (item: NotificationItem) => {
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
    <div className="relative" ref={menuRef}>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Notifications"
        onClick={() => setIsOpen(!isOpen)}
        className="relative"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div className="absolute end-0 mt-2 w-80 sm:w-96 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3.5 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Check size={12} />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No active notifications or alerts.
              </div>
            ) : (
              items.slice(0, 10).map((item) => {
                const targetLink = linkForType(item);
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 transition-colors text-xs space-y-1.5 ${
                      item.isRead ? "bg-card" : "bg-primary/5 font-medium"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5">{iconForType(item.type)}</span>
                        <div className="font-semibold text-foreground">
                          {item.title}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!item.isRead && (
                          <button
                            type="button"
                            title="Mark as read"
                            onClick={() => handleMarkRead(item.id)}
                            className="text-muted-foreground hover:text-foreground p-0.5"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Dismiss"
                          onClick={() => handleDismiss(item.id)}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    <p className="text-muted-foreground leading-relaxed ps-6">
                      {item.message}
                    </p>

                    {targetLink && (
                      <div className="ps-6 pt-1">
                        <Link
                          href={targetLink}
                          onClick={() => setIsOpen(false)}
                          className="text-primary hover:underline text-xs font-semibold"
                        >
                          View Details →
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border p-2.5 text-center bg-muted/20">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
