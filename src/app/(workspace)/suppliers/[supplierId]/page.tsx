import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { todayBusinessDate } from "@/domain/business-date";
import { can } from "@/domain/permissions";
import { suppliersMessages as t } from "@/i18n/messages/suppliers-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { getSupplier } from "@/server/parties/suppliers";
import {
  addMineAction,
  adjustOpeningAction,
  editMineAction,
  editSupplierAction,
} from "../actions";
import {
  MineForm,
  OpeningCorrectionForm,
  SupplierForm,
} from "../supplier-forms";

type Props = {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export const metadata = { title: t.edit };

const panel = "rounded-[var(--radius)] border border-border bg-card p-4 md:p-5";

export default async function SupplierProfile({ params, searchParams }: Props) {
  const actor = await requireActor();
  if (!can(actor.roleCode, "parties.manage")) notFound();
  const { supplierId } = await params;
  const { saved } = await searchParams;
  const supplier = await getSupplier(getDatabase(), actor, supplierId);
  if (!supplier) notFound();
  const { id, code, updatedAt, mines, ...fields } = supplier;
  const today = todayBusinessDate();

  return (
    <>
      <header className="page-heading">
        <Link
          href="/suppliers"
          className="mb-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t.back}
        </Link>
        <h1 className="[overflow-wrap:anywhere]">{supplier.name}</h1>
        <p>
          {code} · {supplier.isActive ? t.active : t.inactive}
        </p>
      </header>
      {saved === "1" && (
        <p
          className="mb-4 rounded-md bg-positive/10 px-3 py-2 text-sm text-positive"
          role="status"
        >
          {t.posted}
        </p>
      )}
      <div className="grid content-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className={panel} aria-labelledby="supplier-details">
          <h2 id="supplier-details" className="mb-4 font-semibold">
            {t.details}
          </h2>
          <SupplierForm
            action={editSupplierAction.bind(null, id, updatedAt.toISOString())}
            requestKey={randomUUID()}
            initial={fields}
            today={today}
            allowOpening={false}
          />
        </section>
        <div className="grid content-start gap-4">
          <section className={panel} aria-labelledby="supplier-mines">
            <h2 id="supplier-mines" className="mb-3 font-semibold">
              {t.mines}
            </h2>
            {mines.length ? (
              <ul className="divide-y divide-border border-y border-border">
                {mines.map((mine) => (
                  <li key={mine.id}>
                    <details className="py-3">
                      <summary className="cursor-pointer text-sm font-semibold [overflow-wrap:anywhere]">
                        {mine.code} · {mine.name}
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          {mine.isDefault
                            ? t.defaultMine
                            : mine.isActive
                              ? t.active
                              : t.inactive}
                        </span>
                      </summary>
                      <div className="mt-3">
                        <MineForm
                          action={editMineAction.bind(
                            null,
                            id,
                            mine.id,
                            mine.updatedAt.toISOString(),
                          )}
                          requestKey={randomUUID()}
                          initial={mine}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">{t.noMines}</p>
            )}
            <details className="mt-4" open={!mines.length}>
              <summary className="cursor-pointer text-sm font-semibold text-primary">
                {t.newMine}
              </summary>
              <div className="mt-3">
                <MineForm
                  action={addMineAction.bind(null, id)}
                  requestKey={randomUUID()}
                />
              </div>
            </details>
          </section>
          {can(actor.roleCode, "parties.openingBalance") && (
            <section className={panel} aria-labelledby="supplier-payable">
              <h2 id="supplier-payable" className="mb-3 font-semibold">
                {t.correction}
              </h2>
              <OpeningCorrectionForm
                action={adjustOpeningAction.bind(null, id)}
                requestKey={randomUUID()}
                today={today}
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
