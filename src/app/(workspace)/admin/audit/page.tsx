import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuditOutcome } from "@/generated/prisma/enums";
import { administration } from "@/i18n/messages/admin-en";
import { parseAuditFilters, readAuditTimeline } from "@/server/admin/audit";
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

const t = administration.audit;
const path = "/admin/audit";
export const metadata = { title: t.title };

type Query = Record<string, string | string[] | undefined>;
type Snapshot = Record<string, string | number | boolean | null> | undefined;
type Timeline = Awaited<ReturnType<typeof readAuditTimeline>>;

function AuditFilters({
  query,
  people,
}: {
  query: Query;
  people: Timeline["people"];
}) {
  function value(name: string) {
    const raw = query[name];
    return typeof raw === "string" ? raw : "";
  }
  return (
    <form
      action={path}
      className={`${adminPanel} grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 2xl:grid-cols-5`}
    >
      <AdminField label={administration.actor}>
        <select
          name="actor"
          className={adminInput}
          defaultValue={value("actor")}
        >
          <option value="">{t.allActors}</option>
          <option value="SYSTEM">{t.system}</option>
          <option value="ANONYMOUS">{t.anonymous}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName} ({person.username})
            </option>
          ))}
        </select>
      </AdminField>
      <AdminField label={t.action}>
        <input
          name="action"
          className={adminInput}
          maxLength={120}
          placeholder={t.actionExample}
          defaultValue={value("action")}
        />
      </AdminField>
      <AdminField label={t.outcome}>
        <select
          name="outcome"
          className={adminInput}
          defaultValue={value("outcome")}
        >
          <option value="">{t.allOutcomes}</option>
          {Object.values(AuditOutcome).map((outcome) => (
            <option key={outcome} value={outcome}>
              {administration.outcome[outcome]}
            </option>
          ))}
        </select>
      </AdminField>
      <AdminField label={administration.dateFrom}>
        <input
          name="from"
          type="date"
          className={adminInput}
          defaultValue={value("from")}
        />
      </AdminField>
      <AdminField label={administration.dateTo}>
        <input
          name="to"
          type="date"
          className={adminInput}
          defaultValue={value("to")}
        />
      </AdminField>
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Button type="submit">{t.apply}</Button>
        <Button variant="outline" asChild>
          <Link href={path}>{t.reset}</Link>
        </Button>
      </div>
    </form>
  );
}

function EventSnapshot({ title, values }: { title: string; values: Snapshot }) {
  if (!values || !Object.keys(values).length) return null;
  return (
    <div>
      <p className="mb-1 font-semibold">{title}</p>
      <dl className="text-muted-foreground">
        {Object.entries(values).map(([field, value]) => (
          <div key={field} className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{field}</dt>
            <dd className="wrap-anywhere">
              {value === null ? "—" : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const headers = [
  administration.dateTime,
  administration.actor,
  t.action,
  t.target,
  t.outcome,
  t.changes,
];

function AuditTable({ events }: { events: Timeline["events"] }) {
  if (!events.length)
    return (
      <p className={`${adminPanel} p-5 text-sm text-muted-foreground`}>
        {t.empty}
      </p>
    );

  return (
    <div
      className={`${adminPanel} overflow-x-auto`}
      tabIndex={0}
      role="region"
      aria-label={t.title}
    >
      <table className={`${adminTable} min-w-[49rem]`}>
        <thead>
          <tr className="border-b text-start">
            {headers.map((label) => (
              <th key={label} scope="col" className={`${adminCell} text-start`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="border-b align-top last:border-0 [&>td]:align-top"
            >
              <td className={`${adminCell} whitespace-nowrap tabular-nums`}>
                <time dateTime={event.occurredAt.toISOString()}>
                  {adminTime(event.occurredAt)}
                </time>
              </td>
              <td className={adminCell}>
                {event.actorType === "USER"
                  ? event.actorName
                  : event.actorType === "SYSTEM"
                    ? t.system
                    : t.anonymous}
                {event.actorUsername && (
                  <span className="block text-xs text-muted-foreground">
                    {event.actorUsername}
                  </span>
                )}
              </td>
              <td className={`${adminCell} wrap-anywhere`}>
                <span className="font-medium">{event.action}</span>
                <span className="block text-xs text-muted-foreground">
                  {event.area}
                </span>
              </td>
              <td className={`${adminCell} max-w-44 wrap-anywhere`}>
                {event.targetType}
                {event.targetId && (
                  <span className="block text-xs text-muted-foreground">
                    {event.targetId}
                  </span>
                )}
              </td>
              <td
                className={`${adminCell} ${event.outcome === "SUCCESS" ? "text-positive" : "text-negative"}`}
              >
                {administration.outcome[event.outcome]}
              </td>
              <td className={`${adminCell} min-w-36`}>
                <details>
                  <summary className="cursor-pointer whitespace-nowrap text-primary">
                    {t.changes}
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <dl className="text-muted-foreground">
                      <dt className="font-medium">{t.ip}</dt>
                      <dd>{event.ipAddress ?? "—"}</dd>
                      <dt className="mt-1 font-medium">{t.request}</dt>
                      <dd className="wrap-anywhere">{event.requestId}</dd>
                    </dl>
                    <EventSnapshot title={t.before} values={event.before} />
                    <EventSnapshot title={t.after} values={event.after} />
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const actor = await requireAdmin("admin.audit");
  const query = await searchParams;
  const filter = parseAuditFilters(query);
  const timeline = await readAuditTimeline(
    getDatabase(),
    actor,
    filter.success ? filter.data : {},
  );
  const pagination = new URLSearchParams();
  if (filter.success) {
    for (const [key, value] of Object.entries(filter.data)) {
      if (key !== "before" && value) pagination.set(key, value);
    }
  }
  const newest = pagination.size ? `${path}?${pagination}` : path;
  if (timeline.older) pagination.set("before", timeline.older);

  return (
    <>
      <AdminHeading title={t.title} description={t.description} />
      <div className="grid min-w-0 gap-4">
        <AuditFilters query={query} people={timeline.people} />
        {filter.success ? (
          <AuditTable events={timeline.events} />
        ) : (
          <p className="text-sm text-negative" role="alert">
            {t.invalid}
          </p>
        )}
        {filter.success && (filter.data.before || timeline.older) && (
          <nav className="flex flex-wrap gap-3" aria-label={t.title}>
            {filter.data.before && (
              <Button variant="outline" asChild>
                <Link href={newest}>{t.latest}</Link>
              </Button>
            )}
            {timeline.older && (
              <Button variant="outline" asChild>
                <Link href={`${path}?${pagination}`}>{t.older}</Link>
              </Button>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
