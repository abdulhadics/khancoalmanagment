import { Archive, CircleAlert } from "lucide-react";
import Link from "next/link";
import { backup as t } from "@/i18n/messages/backup-en";
import type { readLatestBackup } from "@/server/admin/backups";
import { adminTime } from "../admin-ui";

type Status = Awaited<ReturnType<typeof readLatestBackup>>;

export function BackupStatus({
  latest,
  showLink = false,
}: {
  latest: Status;
  showLink?: boolean;
}) {
  const { completedAt, stale } = latest;
  const Icon = stale ? CircleAlert : Archive;
  return (
    <section
      aria-label={t.last}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${stale ? "border-amber-200 bg-amber-50" : "border-border bg-card"}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          size={18}
          aria-hidden="true"
          className={`mt-0.5 shrink-0 ${stale ? "text-warning" : "text-positive"}`}
        />
        <div>
          <p className="font-semibold">
            {completedAt ? (
              <>
                {t.last} ·{" "}
                <time dateTime={completedAt.toISOString()}>
                  {adminTime(completedAt)}
                </time>
              </>
            ) : (
              t.none
            )}
          </p>
          {completedAt && stale && (
            <p className="mt-1 text-warning">{t.stale}</p>
          )}
        </div>
      </div>
      {showLink && (
        <Link
          href="/admin/backups"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t.view}
        </Link>
      )}
    </section>
  );
}
