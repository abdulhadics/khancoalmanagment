import Link from "next/link";
import { staffMessages as t } from "@/i18n/messages/staff-en";
import { requireStaffManager } from "../access";
import { CreateStaffForm } from "../staff-forms";

export default async function NewStaffPage() {
  await requireStaffManager();
  return (
    <div className="max-w-3xl">
      <header className="page-heading">
        <Link
          className="mb-3 inline-block text-sm font-semibold text-primary hover:underline"
          href="/settings/users"
        >
          {t.back}
        </Link>
        <h1>{t.add}</h1>
        <p>{t.createDescription}</p>
      </header>
      <CreateStaffForm />
    </div>
  );
}
