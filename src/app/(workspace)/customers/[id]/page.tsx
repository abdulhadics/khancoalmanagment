import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatCurrency } from "@/domain/number-display";
import { can } from "@/domain/permissions";
import { customersMessages as t } from "@/i18n/messages/customers-en";
import { requireActor } from "@/server/auth/request-context";
import { readCustomer } from "@/server/customers";
import { getDatabase } from "@/server/db/client";
import { readDocumentDisplayPreferences } from "@/server/settings/company";
import { CustomerForm } from "../customer-form";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.manage")) notFound();
  const { id } = await params;
  const database = getDatabase();
  const customer = await readCustomer(database, actor, id);
  if (!customer) notFound();
  const preferences = await readDocumentDisplayPreferences(database);
  const openingDisplay = customer.opening
    ? {
        amount: formatCurrency(customer.opening.amount, preferences),
        date: formatDocumentDate(
          parseBusinessDate(customer.opening.date),
          preferences.dateFormat,
        ),
      }
    : undefined;
  const { saved } = await searchParams;
  return (
    <div className="max-w-4xl">
      <header className="page-heading">
        <Link
          className="mb-3 inline-block text-sm font-semibold text-primary hover:underline"
          href="/customers"
        >
          {t.title}
        </Link>
        <h1 className="[overflow-wrap:anywhere]">{customer.name}</h1>
        <p>{customer.code}</p>
      </header>
      {saved === "1" && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-positive/25 bg-positive/5 px-4 py-3 text-sm text-positive"
        >
          {t.saved}
        </p>
      )}
      <CustomerForm
        customer={customer}
        openingDisplay={openingDisplay}
        openingAllowed={can(actor.roleCode, "parties.openingBalance")}
        today={todayBusinessDate()}
        requestKey={randomUUID()}
      />
    </div>
  );
}
