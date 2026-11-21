import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayBusinessDate } from "@/domain/business-date";
import { can } from "@/domain/permissions";
import { customersMessages as t } from "@/i18n/messages/customers-en";
import { requireActor } from "@/server/auth/request-context";
import { CustomerForm } from "../customer-form";

export default async function NewCustomerPage() {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.manage")) notFound();
  return (
    <div className="max-w-4xl">
      <header className="page-heading">
        <Link
          className="mb-3 inline-block text-sm font-semibold text-primary hover:underline"
          href="/customers"
        >
          {t.title}
        </Link>
        <h1>{t.add}</h1>
        <p>{t.addDescription}</p>
      </header>
      <CustomerForm
        openingAllowed={can(actor.roleCode, "parties.openingBalance")}
        today={todayBusinessDate()}
        requestKey={randomUUID()}
      />
    </div>
  );
}
