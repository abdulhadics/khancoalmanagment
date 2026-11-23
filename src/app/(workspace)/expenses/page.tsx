import { DollarSign, Filter, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { todayBusinessDate } from "@/domain/business-date";
import { formatCurrency } from "@/domain/number-display";
import { can, requirePermission } from "@/domain/permissions";
import { expenses as t } from "@/i18n/messages/expenses-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { readExpensesList } from "@/server/expenses/queries";
import { readDocumentDisplayPreferences } from "@/server/settings/company";
import { ExpenseForm } from "./expense-form";
import { VoidButton } from "./void-button";

type Query = Record<string, string | string[] | undefined>;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const [actor, query] = await Promise.all([requireActor(), searchParams]);
  requirePermission(actor, "expenses.view");

  const database = getDatabase();
  const today = todayBusinessDate();

  const field = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;

  const filters = {
    category: field("category"),
    from: field("from"),
    to: field("to"),
    page: field("page") ? Number(field("page")) : 1,
  };

  const [data, preferences] = await Promise.all([
    readExpensesList(database, actor, filters),
    readDocumentDisplayPreferences(database),
  ]);

  const canManage = can(actor.roleCode, "expenses.manage");
  const canVoid = can(actor.roleCode, "expenses.void");

  const pageQuery = (p: number) => {
    const q = new URLSearchParams();
    if (filters.category) q.set("category", filters.category);
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    q.set("page", String(p));
    return `/expenses?${q.toString()}`;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        {canManage && <ExpenseForm today={today} />}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t.totalExpenses}</span>
            <DollarSign size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatCurrency(data.totalActiveAmount, preferences)}
          </div>
          <span className="text-xs text-muted-foreground">Active non-voided expenses</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">{t.expenseCount}</span>
            <ReceiptText size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold">{data.totalCount}</div>
          <span className="text-xs text-muted-foreground">Total recorded entries</span>
        </div>
      </div>

      {/* Filter Bar */}
      <form
        action="/expenses"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <div className="min-w-40 flex-1 space-y-1">
          <label htmlFor="category-select" className="text-xs font-semibold text-muted-foreground">
            {t.category}
          </label>
          <select
            id="category-select"
            name="category"
            defaultValue={filters.category ?? "all"}
            className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="all">{t.allCategories}</option>
            {Object.entries(t.categories).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="from-date" className="text-xs font-semibold text-muted-foreground">
            From
          </label>
          <input
            id="from-date"
            name="from"
            type="date"
            defaultValue={filters.from}
            className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="to-date" className="text-xs font-semibold text-muted-foreground">
            To
          </label>
          <input
            id="to-date"
            name="to"
            type="date"
            defaultValue={filters.to}
            className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="flex items-center gap-1.5">
            <Filter size={15} />
            <span>Apply</span>
          </Button>
          {(filters.category || filters.from || filters.to) && (
            <Button asChild variant="outline">
              <Link href="/expenses">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="p-3.5">{t.date}</th>
                <th className="p-3.5">{t.category}</th>
                <th className="p-3.5">{t.descriptionLabel}</th>
                <th className="p-3.5 text-right">{t.amount}</th>
                <th className="p-3.5">Logged By</th>
                <th className="p-3.5">{t.status}</th>
                {canVoid && <th className="p-3.5 text-right">{t.actions}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    {t.noMatches}
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-muted/20 ${row.voidedAt ? "opacity-50 line-through" : ""}`}
                  >
                    <td className="whitespace-nowrap p-3.5 font-medium">{row.businessDate}</td>
                    <td className="whitespace-nowrap p-3.5">
                      <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {t.categories[row.category as keyof typeof t.categories] ?? row.category}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div>{row.description}</div>
                      {row.notes && (
                        <div className="text-xs text-muted-foreground">{row.notes}</div>
                      )}
                      {row.voidReason && (
                        <div className="text-xs text-red-500">Void reason: {row.voidReason}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right font-semibold">
                      {formatCurrency(row.amount, preferences)}
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-xs text-muted-foreground">
                      {row.createdByName}
                    </td>
                    <td className="whitespace-nowrap p-3.5">
                      {row.voidedAt ? (
                        <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          {t.voided}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {t.active}
                        </span>
                      )}
                    </td>
                    {canVoid && (
                      <td className="whitespace-nowrap p-3.5 text-right">
                        {!row.voidedAt && <VoidButton expenseId={row.id} />}
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
