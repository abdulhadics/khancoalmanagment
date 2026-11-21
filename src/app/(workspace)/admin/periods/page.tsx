import { todayBusinessDate } from "@/domain/business-date";
import { Button } from "@/components/ui/button";
import { administration as t } from "@/i18n/messages/admin-en";
import { salesDetailsMessages } from "@/i18n/messages/sales-details-en";
import { accountingYear, readAccountingYear } from "@/server/admin/periods";
import { getDatabase } from "@/server/db/client";
import {
  adminCell,
  AdminField,
  AdminHeading,
  adminInput,
  adminPanel,
  adminTable,
  adminTime,
  requireAdmin,
} from "../admin-ui";
import { PeriodForm } from "./period-form";

const p = t.period;
export const metadata = { title: p.title };

export default async function AccountingPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin("admin.periods");
  const requested = accountingYear.safeParse((await searchParams).year);
  const year = requested.success
    ? requested.data
    : todayBusinessDate().slice(0, 4);
  const months = await readAccountingYear(getDatabase(), actor, year);
  const yearLocks = months.filter((gate) => gate.isYearLocked).length;

  return (
    <>
      <AdminHeading title={p.title} description={p.description} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
        <section className={adminPanel} aria-labelledby="period-month-status">
          <div className="flex flex-wrap items-end justify-between gap-4 p-4 sm:p-5">
            <div>
              <h2 id="period-month-status" className="font-semibold">
                {p.statusTitle}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {p.wholeYear} {year} ·{" "}
                {yearLocks === 12 ? p.closed : yearLocks ? p.partial : p.open}
              </p>
            </div>
            <form action="/admin/periods" className="flex items-end gap-2">
              <AdminField label={t.year}>
                <input
                  type="number"
                  name="year"
                  min="1000"
                  max="9999"
                  required
                  defaultValue={year}
                  className={`${adminInput} max-w-28`}
                />
              </AdminField>
              <Button type="submit" variant="outline" className="h-10">
                {p.selectYear}
              </Button>
            </form>
          </div>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-labelledby="period-month-status"
          >
            <table className={`${adminTable} min-w-[29rem]`}>
              <thead>
                <tr className="border-y text-start">
                  <th scope="col" className={`${adminCell} text-start`}>
                    {p.month}
                  </th>
                  <th scope="col" className={`${adminCell} text-start`}>
                    {p.monthLock}
                  </th>
                  <th scope="col" className={`${adminCell} text-start`}>
                    {p.yearLock}
                  </th>
                  <th scope="col" className={`${adminCell} text-start`}>
                    {p.lastUpdated}
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((month, index) => (
                  <tr key={month.month} className="border-b last:border-0">
                    <th
                      scope="row"
                      className={`${adminCell} text-start text-foreground`}
                    >
                      {salesDetailsMessages.months[index]}
                    </th>
                    <td className={adminCell}>
                      {month.isMonthLocked ? p.closed : p.open}
                    </td>
                    <td className={adminCell}>
                      {month.isYearLocked ? p.closed : p.open}
                    </td>
                    <td className={`${adminCell} text-muted-foreground`}>
                      {month.updatedAt ? (
                        <>
                          <time dateTime={month.updatedAt.toISOString()}>
                            {adminTime(month.updatedAt)}
                          </time>
                          <span className="block">{month.updatedBy}</span>
                        </>
                      ) : (
                        p.noChange
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section
          className={`${adminPanel} p-4 sm:p-5`}
          aria-labelledby="period-change"
        >
          <h2 className="mb-4 font-semibold" id="period-change">
            {p.change}
          </h2>
          <PeriodForm key={year} year={year} />
        </section>
      </div>
    </>
  );
}
