import { Button } from "@/components/ui/button";
import { todayBusinessDate } from "@/domain/business-date";
import { formatCurrency } from "@/domain/number-display";
import { administration } from "@/i18n/messages/admin-en";
import {
  parseIntegrityPeriod,
  runAdminIntegrityCheck,
} from "@/server/admin/integrity";
import { getDatabase } from "@/server/db/client";
import { ReportPeriodError } from "@/server/reporting/period";
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

const t = administration.integrity;
const path = "/admin/integrity";
const moneyCell = `${adminCell} whitespace-nowrap text-end tabular-nums`;

type Query = Record<string, string | string[] | undefined>;
type Result = Awaited<ReturnType<typeof runAdminIntegrityCheck>>;
export const metadata = { title: t.title };

function IntegrityResults({ result }: { result: Result }) {
  const { accounting, balances } = result;
  const total =
    accounting.total + balances.filter((balance) => !balance.matches).length;
  return (
    <>
      <div
        className={`${adminPanel} flex flex-wrap items-center justify-between gap-2 p-4 text-sm`}
        role="status"
      >
        <strong className={total ? "text-negative" : "text-positive"}>
          {total ? t.problems(total) : t.checksPassed}
        </strong>
        <time
          dateTime={accounting.checkedAt.toISOString()}
          className="text-muted-foreground"
        >
          {adminTime(accounting.checkedAt)}
        </time>
      </div>
      <section className={adminPanel} aria-labelledby="integrity-balances">
        <h2 className="p-4 font-semibold" id="integrity-balances">
          {t.balances}
        </h2>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-labelledby="integrity-balances"
        >
          <table className={`${adminTable} min-w-[49rem]`}>
            <thead>
              <tr className="border-y">
                <th scope="col" className={`${adminCell} text-start`}>
                  {t.party}
                </th>
                {[
                  t.opening,
                  t.billed,
                  t.settled,
                  t.adjustments,
                  t.closing,
                  t.reported,
                ].map((label) => (
                  <th key={label} scope="col" className={moneyCell}>
                    {label}
                  </th>
                ))}
                <th scope="col" className={`${adminCell} text-start`}>
                  {t.status}
                </th>
              </tr>
            </thead>
            <tbody>
              {balances.map((balance) => (
                <tr key={balance.party} className="border-b last:border-0">
                  <th scope="row" className={`${adminCell} text-start`}>
                    {t[balance.party]}
                  </th>
                  {[
                    balance.opening,
                    balance.billed,
                    balance.settled,
                    balance.adjustments,
                    balance.closing,
                    balance.reportedClosing,
                  ].map((value, index) => (
                    <td className={moneyCell} key={index}>
                      {formatCurrency(value, balance.preferences)}
                    </td>
                  ))}
                  <td
                    className={`${adminCell} ${balance.matches ? "text-positive" : "text-negative"}`}
                  >
                    {balance.matches ? t.reconciles : t.discrepancy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {accounting.total > 0 && (
        <section className={adminPanel} aria-labelledby="integrity-findings">
          <div className="p-4">
            <h2 className="font-semibold" id="integrity-findings">
              {t.findings}
            </h2>
            {accounting.findings.length < accounting.total && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t.shown(accounting.findings.length, accounting.total)}
              </p>
            )}
          </div>
          <table className={`${adminTable} table-fixed`}>
            <thead>
              <tr className="border-y">
                <th scope="col" className={`${adminCell} text-start`}>
                  {t.kind}
                </th>
                <th scope="col" className={`${adminCell} text-start`}>
                  {t.record}
                </th>
              </tr>
            </thead>
            <tbody>
              {accounting.findings.map(({ kind, subject }) => (
                <tr
                  key={`${kind}-${subject}`}
                  className="border-b last:border-0"
                >
                  <td className={adminCell}>{t.kinds[kind]}</td>
                  <td className={`${adminCell} wrap-anywhere`}>{subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireAdmin("admin.integrity");
  const query = await searchParams;
  const today = todayBusinessDate();
  const from =
    typeof query.from === "string" ? query.from : `${today.slice(0, 7)}-01`;
  const to = typeof query.to === "string" ? query.to : today;
  let result: Result | undefined;
  let invalid = false;
  if (query.run === "1") {
    try {
      result = await runAdminIntegrityCheck(
        getDatabase(),
        actor,
        parseIntegrityPeriod({ from, to }),
      );
    } catch (error) {
      if (!(error instanceof ReportPeriodError)) throw error;
      invalid = true;
    }
  }

  return (
    <>
      <AdminHeading title={t.title} description={t.description} />
      <div className="grid min-w-0 gap-4">
        <form
          action={path}
          className={`${adminPanel} flex flex-wrap items-end gap-3 p-4 sm:p-5`}
        >
          <input type="hidden" name="run" value="1" />
          <AdminField label={administration.dateFrom}>
            <input
              name="from"
              type="date"
              defaultValue={from}
              className={adminInput}
            />
          </AdminField>
          <AdminField label={administration.dateTo}>
            <input
              name="to"
              type="date"
              defaultValue={to}
              className={adminInput}
            />
          </AdminField>
          <Button type="submit" className="h-10">
            {t.run}
          </Button>
        </form>
        {invalid && (
          <p className="text-sm text-negative" role="alert">
            {t.invalid}
          </p>
        )}
        {result && <IntegrityResults result={result} />}
      </div>
    </>
  );
}
