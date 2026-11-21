import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayBusinessDate } from "@/domain/business-date";
import { can } from "@/domain/permissions";
import { suppliersMessages as t } from "@/i18n/messages/suppliers-en";
import { requireActor } from "@/server/auth/request-context";
import { createSupplierAction } from "../actions";
import { SupplierForm } from "../supplier-forms";

export const metadata = { title: t.add };

export default async function NewSupplier() {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.manage")) notFound();
  return (
    <>
      <header className="page-heading">
        <Link
          href="/suppliers"
          className="mb-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t.back}
        </Link>
        <h1>{t.add}</h1>
      </header>
      <section
        className="max-w-4xl rounded-[var(--radius)] border border-border bg-card p-4 md:p-6"
        aria-label={t.details}
      >
        <SupplierForm
          action={createSupplierAction}
          requestKey={randomUUID()}
          today={todayBusinessDate()}
          allowOpening={can(actor.roleCode, "parties.openingBalance")}
        />
      </section>
    </>
  );
}
