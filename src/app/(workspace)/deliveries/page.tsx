import { CheckCircle2, Clock, Filter, Scale } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { todayBusinessDate } from "@/domain/business-date";
import { can, requirePermission } from "@/domain/permissions";
import { deliveries as t } from "@/i18n/messages/deliveries-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  readActiveCustomers,
  readDeliveriesList,
  type DeliveryFilterOptions,
} from "@/server/deliveries/queries";
import { DeliveryForm } from "./delivery-form";
import { PickupForm } from "./pickup-form";

type Query = Record<string, string | string[] | undefined>;

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const [actor, query] = await Promise.all([requireActor(), searchParams]);
  requirePermission(actor, "deliveries.view");

  const database = getDatabase();
  const today = todayBusinessDate();

  const field = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;

  const filters: DeliveryFilterOptions = {
    customerId: field("customerId"),
    status: (field("status") as DeliveryFilterOptions["status"]) ?? "pending",
    page: field("page") ? Number(field("page")) : 1,
  };

  const [data, customers] = await Promise.all([
    readDeliveriesList(database, actor, filters),
    readActiveCustomers(database),
  ]);

  const canManage = can(actor.roleCode, "deliveries.manage");

  const pageQuery = (p: number) => {
    const q = new URLSearchParams();
    if (filters.customerId) q.set("customerId", filters.customerId);
    if (filters.status) q.set("status", filters.status);
    q.set("page", String(p));
    return `/deliveries?${q.toString()}`;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        {canManage && <DeliveryForm today={today} customers={customers} />}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t.totalRemaining}</span>
            <Scale size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-600">
            {data.totalRemainingWeight} TON
          </div>
          <span className="text-xs text-muted-foreground">Coal paid for but not yet picked up</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t.pendingCustomers}</span>
            <Clock size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold">{data.pendingCount}</div>
          <span className="text-xs text-muted-foreground">Active pending orders</span>
        </div>
      </div>

      {/* Filter Bar */}
      <form
        action="/deliveries"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <div className="min-w-44 flex-1 space-y-1">
          <label htmlFor="customer-select" className="text-xs font-semibold text-muted-foreground">
            {t.customer}
          </label>
          <select
            id="customer-select"
            name="customerId"
            defaultValue={filters.customerId ?? ""}
            className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="status-select" className="text-xs font-semibold text-muted-foreground">
            {t.status}
          </label>
          <select
            id="status-select"
            name="status"
            defaultValue={filters.status ?? "pending"}
            className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="pending">{t.pending}</option>
            <option value="completed">{t.completed}</option>
            <option value="all">All records</option>
          </select>
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="flex items-center gap-1.5">
            <Filter size={15} />
            <span>Apply</span>
          </Button>
          {(filters.customerId || (filters.status && filters.status !== "pending")) && (
            <Button asChild variant="outline">
              <Link href="/deliveries">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      {/* Deliveries Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="p-3.5">{t.date}</th>
                <th className="p-3.5">{t.customer}</th>
                <th className="p-3.5 text-right">{t.orderedWeight}</th>
                <th className="p-3.5 text-right">{t.deliveredWeight}</th>
                <th className="p-3.5 text-right">{t.remainingWeight}</th>
                <th className="p-3.5">{t.status}</th>
                <th className="p-3.5 text-right">Pickups</th>
                {canManage && <th className="p-3.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    {t.noMatches}
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="whitespace-nowrap p-3.5 font-medium">{row.businessDate}</td>
                    <td className="p-3.5">
                      <div className="font-semibold">{row.customerName}</div>
                      <div className="text-xs text-muted-foreground">{row.customerCode}</div>
                      {row.notes && (
                        <div className="text-xs text-muted-foreground">{row.notes}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right font-medium">
                      {row.orderedWeight} TON
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right text-emerald-600 font-medium">
                      {row.deliveredWeight} TON
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right font-bold text-amber-600">
                      {row.remainingWeight} TON
                    </td>
                    <td className="whitespace-nowrap p-3.5">
                      {row.isComplete ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 size={12} />
                          {t.completed}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          <Clock size={12} />
                          {t.pending}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right">
                      <Link
                        href={`/deliveries/${row.id}`}
                        className="text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                      >
                        {row.pickupsCount} pickup{row.pickupsCount === 1 ? "" : "s"}
                      </Link>
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap p-3.5 text-right">
                        {!row.isComplete && (
                          <PickupForm
                            deliveryRecordId={row.id}
                            customerName={row.customerName}
                            remainingWeight={row.remainingWeight}
                            today={today}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data.lastPage > 1 && (
          <div className="flex items-center justify-between border-t border-border p-4 text-sm">
            <span className="text-xs text-muted-foreground">
              Page {data.page} of {data.lastPage} ({data.totalCount} entries)
            </span>
            <div className="flex gap-2">
              {data.page > 1 && (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageQuery(data.page - 1)}>Previous</Link>
                </Button>
              )}
              {data.page < data.lastPage && (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageQuery(data.page + 1)}>Next</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
