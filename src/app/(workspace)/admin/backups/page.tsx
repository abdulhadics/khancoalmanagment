import { Button } from "@/components/ui/button";
import { backup as t } from "@/i18n/messages/backup-en";
import { readBackupOverview } from "@/server/admin/backups";
import { getDatabase } from "@/server/db/client";
import {
  AdminHeading,
  adminCell,
  adminPanel,
  adminTable,
  adminTime,
  requireAdmin,
} from "../admin-ui";
import { BackupStatus } from "./status";

export const metadata = { title: t.title };

function BackupTime({ date }: { date: Date | null }) {
  return date ? (
    <time dateTime={date.toISOString()}>{adminTime(date)}</time>
  ) : (
    t.unavailable
  );
}

export default async function BackupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin("admin.backups");
  const [overview, query] = await Promise.all([
    readBackupOverview(getDatabase(), actor),
    searchParams,
  ]);
  const { configured, records, latest } = overview;
  const error =
    query.download === "busy"
      ? t.busy
      : query.download === "failed"
        ? t.failed
        : query.download === "unconfigured"
          ? t.unconfigured
          : null;

  return (
    <>
      <AdminHeading title={t.title} description={t.description} />
      <div className="grid gap-4">
        <BackupStatus latest={latest} />
        <section className={`${adminPanel} grid gap-3 p-4 sm:p-5`}>
          <p className="text-sm text-muted-foreground">{t.excluded}</p>
          {configured ? (
            <form
              method="post"
              action="/admin/backups/download"
              className="flex flex-wrap items-center gap-3"
            >
              <Button type="submit">{t.download}</Button>
              <p className="text-sm text-muted-foreground">{t.downloadHelp}</p>
            </form>
          ) : (
            <p role="status" className="text-sm text-warning">
              {t.unconfigured}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
        </section>
        <section aria-labelledby="backup-history" className={adminPanel}>
          <h2 id="backup-history" className="p-4 font-semibold sm:p-5">
            {t.history}
          </h2>
          {records.length ? (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-labelledby="backup-history"
            >
              <table className={`${adminTable} min-w-[40rem] text-start`}>
                <thead>
                  <tr>
                    {[t.source, t.state, t.started, t.completed, t.archive].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className={`${adminCell} text-start`}
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b last:border-0">
                      <td className={adminCell}>{t.sources[record.source]}</td>
                      <td className={adminCell}>{t.states[record.state]}</td>
                      <td className={adminCell}>
                        <BackupTime date={record.startedAt} />
                      </td>
                      <td className={adminCell}>
                        <BackupTime date={record.completedAt} />
                      </td>
                      <td className={`${adminCell} max-w-72 break-all`}>
                        {record.archiveId ?? t.unavailable}
                        {record.archiveHash && (
                          <code className="block text-xs text-muted-foreground">
                            {record.archiveHash}
                          </code>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">
              {t.empty}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
