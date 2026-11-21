import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { staffMessages as t } from "@/i18n/messages/staff-en";
import { listStaff } from "@/server/auth/staff";
import { getDatabase } from "@/server/db/client";
import { requireStaffManager } from "./access";

const signInFormat = new Intl.DateTimeFormat("en-PK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Karachi",
});

function LastSignIn({ value }: { value: Date | null }) {
  if (!value) return t.neverSignedIn;
  return (
    <time dateTime={value.toISOString()}>{signInFormat.format(value)}</time>
  );
}

export default async function StaffPage() {
  const actor = await requireStaffManager();
  const staff = await listStaff(getDatabase(), actor);

  return (
    <>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <Button asChild>
          <Link href="/settings/users/new">
            <Plus size={17} aria-hidden="true" />
            {t.add}
          </Link>
        </Button>
      </header>
      {staff.length ? (
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <table className="w-full table-fixed text-start text-sm">
            <caption className="sr-only">{t.title}</caption>
            <thead className="border-b border-border bg-muted/55 text-muted-foreground">
              <tr>
                <th
                  scope="col"
                  className="w-1/2 px-3 py-3 text-start font-semibold sm:w-[38%] sm:px-5"
                >
                  {t.staffMember}
                </th>
                <th
                  scope="col"
                  className="w-[28%] px-1 py-3 text-start font-semibold sm:w-[21%] sm:px-3"
                >
                  {t.role}
                </th>
                <th
                  scope="col"
                  className="hidden w-[26%] px-3 py-3 text-start font-semibold sm:table-cell"
                >
                  {t.lastLogin}
                </th>
                <th
                  scope="col"
                  className="w-[22%] px-3 py-3 sm:w-[15%] sm:px-5"
                >
                  <span className="sr-only">{t.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.map((member) => (
                <tr
                  key={member.id}
                  className="align-top transition-colors hover:bg-muted/30"
                >
                  <td className="px-3 py-4 sm:px-5">
                    <p className="[overflow-wrap:anywhere] font-semibold">
                      {member.displayName}
                    </p>
                    <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                      {member.email}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground sm:hidden">
                      <LastSignIn value={member.lastLoginAt} />
                    </p>
                  </td>
                  <td className="px-1 py-4 sm:px-3">
                    <p className="[overflow-wrap:anywhere]">
                      {t.roleNames[member.roleCode]}
                    </p>
                    <p
                      className={`mt-1 text-xs font-medium ${member.isActive ? "text-positive" : "text-muted-foreground"}`}
                    >
                      {member.isActive ? t.active : t.disabled}
                    </p>
                  </td>
                  <td className="hidden px-3 py-4 tabular-nums text-muted-foreground sm:table-cell">
                    <LastSignIn value={member.lastLoginAt} />
                  </td>
                  <td className="px-2 py-2 text-end sm:px-5">
                    <Link
                      className="inline-flex min-h-10 items-center rounded-md px-1 text-xs font-semibold text-primary hover:underline sm:px-2 sm:text-sm"
                      href={`/settings/users/${member.id}`}
                    >
                      {t.manage}
                      <span className="sr-only"> {member.displayName}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-[var(--radius)] border border-border bg-card px-5 py-10 text-muted-foreground">
          {t.empty}
        </p>
      )}
    </>
  );
}
