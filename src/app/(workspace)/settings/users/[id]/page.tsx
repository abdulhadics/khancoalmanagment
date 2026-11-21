import Link from "next/link";
import { notFound } from "next/navigation";
import { staffMessages as t } from "@/i18n/messages/staff-en";
import { readStaff } from "@/server/auth/staff";
import { getDatabase } from "@/server/db/client";
import { requireStaffManager } from "../access";
import { StaffAccessForm, StaffPasswordForm } from "../staff-forms";

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const actor = await requireStaffManager();
  const { id } = await params;
  const member = await readStaff(getDatabase(), actor, id);
  if (!member) notFound();

  const { saved } = await searchParams;
  const feedback =
    saved === "create" || saved === "access" || saved === "reset"
      ? t.success[saved]
      : null;

  return (
    <div className="max-w-3xl">
      <header className="page-heading">
        <Link
          className="mb-3 inline-block text-sm font-semibold text-primary hover:underline"
          href="/settings/users"
        >
          {t.back}
        </Link>
        <h1 className="[overflow-wrap:anywhere]">{member.displayName}</h1>
        <p className="[overflow-wrap:anywhere]">
          {member.username} · {member.email}
        </p>
      </header>
      <div className="grid gap-4">
        {feedback && (
          <p
            role="status"
            className="rounded-lg border border-positive/25 bg-positive/5 px-4 py-3 text-sm font-medium text-positive"
          >
            {feedback}
          </p>
        )}
        <StaffAccessForm member={member} />
        <StaffPasswordForm id={member.id} />
      </div>
    </div>
  );
}
