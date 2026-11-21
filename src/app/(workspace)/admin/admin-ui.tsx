import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { can, type Permission } from "@/domain/permissions";
import { administration as t } from "@/i18n/messages/admin-en";
import { requireActor } from "@/server/auth/request-context";

export const adminInput =
  "h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
export const adminPanel = "min-w-0 rounded-xl border border-border bg-card";
export const adminCell = "px-4 py-3 align-middle";
export const adminTable =
  "w-full border-collapse text-sm [&_thead]:bg-muted/45 [&_thead]:text-muted-foreground [&_th]:font-semibold [&_tr]:border-border";

const timestamp = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  dateStyle: "medium",
  timeStyle: "medium",
});

export function adminTime(date: Date) {
  return timestamp.format(date);
}

export async function requireAdmin(permission: Permission) {
  const actor = await requireActor();
  if (!can(actor.roleCode, permission)) notFound();
  return actor;
}

export function AdminHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/settings">{t.settings}</Link>
      </Button>
    </div>
  );
}

export function AdminField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
