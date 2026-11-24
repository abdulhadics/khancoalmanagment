"use client";

import { Decimal } from "decimal.js";
import { Copy, Plus, X } from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { calculateOrderAmounts, parseRate, parseWeight } from "@/domain/money";
import { formatCurrency, formatDecimal } from "@/domain/number-display";
import { orders as t } from "@/i18n/messages/orders-en";
import type { DispatchOptions } from "@/server/orders/workspace";
import { quickAddDispatchParty, submitOrderBatch } from "./actions";
import type { BatchState } from "./form-state";

type DraftFields = Record<keyof typeof t.fields, string> & {
  confirmDuplicateVehicle: boolean;
  confirmCreditLimit: boolean;
};
type Draft = DraftFields & { localId: number };
type Preferences = {
  currencySymbol: string;
  numberFormat: string;
  weightUnit: keyof typeof t.weightUnits;
};
type PartyKind = "customer" | "supplier";

function makeDraft(localId: number, initial?: Partial<DraftFields>): Draft {
  return {
    localId,
    customerId: "",
    supplierId: "",
    mineId: "",
    vehicleNo: "",
    weight: "",
    purchaseRate: "",
    sellRate: "",
    biltyNo: "",
    notes: "",
    confirmDuplicateVehicle: false,
    confirmCreditLimit: false,
    ...initial,
  };
}

function compute(row: Draft, financial: boolean) {
  try {
    const weight = parseWeight(row.weight);
    if (financial) return { weight, ...calculateOrderAmounts(row) };
    return {
      weight,
      buyAmount: "",
      sellAmount: weight
        .times(parseRate(row.sellRate))
        .toFixed(2, Decimal.ROUND_HALF_UP),
      profit: "",
    };
  } catch {
    return null;
  }
}

const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-sm aria-invalid:border-negative";

function QuickParty({
  kind,
  onClose,
  onAdded,
}: {
  kind: PartyKind;
  onClose: () => void;
  onAdded: (result: Awaited<ReturnType<typeof quickAddDispatchParty>>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const title = kind === "customer" ? t.addCustomer : t.addSupplier;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("key", key);
    start(async () => {
      try {
        const result = await quickAddDispatchParty(kind, form);
        if (result.error) setError(result.error);
        else onAdded(result);
      } catch {
        setError(t.errors.party);
      }
    });
  }

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      className="fixed inset-0 m-auto w-[min(92vw,28rem)] rounded-[var(--radius)] border border-border bg-card p-6 text-foreground backdrop:bg-slate-950/50"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <form method="post" onSubmit={submit} className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-medium">
          {t.partyName}
          <input className={fieldClass} name="name" required maxLength={160} />
        </label>
        {kind === "supplier" && (
          <>
            <label className="grid gap-1 text-sm font-medium">
              {t.mineNumber}
              <input
                className={fieldClass}
                name="mineNumber"
                required
                maxLength={60}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t.mineName}
              <input
                className={fieldClass}
                name="mineName"
                required
                maxLength={160}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            {t.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t.saving : t.saveParty}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

type GridProps = {
  initialDate: string;
  firstKey: string;
  dateLocked: boolean;
  financial: boolean;
  managesParties: boolean;
  options: DispatchOptions;
  preferences: Preferences;
  initial?: Partial<DraftFields>;
};

export function OrderGrid(props: GridProps) {
  const [state, action, pending] = useActionState(submitOrderBatch, {});
  const [firstKey] = useState(props.firstKey);
  return (
    <>
      {state.saved && (
        <p
          className="mb-4 rounded-lg border border-positive/25 bg-positive/5 p-3 text-sm text-positive"
          role="status"
        >
          {t.saved(state.saved.count)}{" "}
          <Link
            className="font-semibold underline"
            href={`/orders?date=${state.saved.businessDate}#daily-orders`}
          >
            {t.savedView}
          </Link>
        </p>
      )}
      <GridForm
        key={state.saved?.key ?? firstKey}
        {...props}
        initial={state.saved ? undefined : props.initial}
        initialDate={state.saved?.businessDate ?? props.initialDate}
        requestKey={state.saved?.key ?? firstKey}
        state={state}
        action={action}
        pending={pending}
      />
    </>
  );
}

function GridForm({
  initialDate,
  initial,
  dateLocked,
  financial,
  managesParties,
  options,
  preferences,
  requestKey,
  state,
  action,
  pending,
}: GridProps & {
  requestKey: string;
  state: BatchState;
  action: (data: FormData) => void;
  pending: boolean;
}) {
  const [date, setDate] = useState(initialDate);
  const [count, setCount] = useState("1");
  const [rows, setRows] = useState([makeDraft(1, initial)]);
  const requestedRows = Number(count);
  const validRowCount =
    Number.isInteger(requestedRows) &&
    requestedRows >= 1 &&
    requestedRows <= 100;
  const [customers, setCustomers] = useState(options.customers);
  const [suppliers, setSuppliers] = useState(options.suppliers);
  const [sameSupplier, setSameSupplier] = useState(false);
  const [sameMine, setSameMine] = useState(false);
  const [quick, setQuick] = useState<{
    kind: PartyKind;
    localId: number;
  } | null>(null);
  const [submittedRows, setSubmittedRows] = useState<number[]>([]);
  const validationId = useId();
  const rowCountId = useId();
  const batchForm = useRef<HTMLFormElement>(null);
  const nextId = useRef(2);
  const dirty = rows.some((row) =>
    Object.keys(t.fields).some((field) =>
      Boolean(row[field as keyof typeof t.fields]),
    ),
  );
  const unit = t.weightUnits[preferences.weightUnit];
  const [weight, buy, sell, profit] = rows.reduce(
    (sums, row) => {
      const values = compute(row, financial);
      if (!values) return sums;
      return [
        sums[0].plus(values.weight),
        sums[1].plus(values.buyAmount || "0"),
        sums[2].plus(values.sellAmount || "0"),
        sums[3].plus(values.profit || "0"),
      ] as const;
    },
    [new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)] as const,
  );

  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  useEffect(() => {
    if (pending || !state.issues?.length) return;
    const form = batchForm.current;
    const invalid = form?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(:disabled)',
    );
    (
      invalid ?? form?.querySelector<HTMLElement>("[data-batch-validation]")
    )?.focus();
  }, [pending, state.issues]);

  function updateRow(localId: number, updates: Partial<DraftFields>) {
    setRows((current) =>
      current.map((row) => {
        if (row.localId === localId) return { ...row, ...updates };
        if (sameSupplier && updates.supplierId !== undefined) {
          return {
            ...row,
            supplierId: updates.supplierId,
            mineId: updates.mineId ?? "",
          };
        }
        if (sameMine && updates.mineId !== undefined)
          return { ...row, mineId: updates.mineId };
        return row;
      }),
    );
  }

  function changeSupplier(localId: number, supplierId: string) {
    const mineId =
      suppliers
        .find(({ id }) => id === supplierId)
        ?.mines.find(({ isDefault }) => isDefault)?.id ?? "";
    updateRow(localId, { supplierId, mineId });
  }

  function addRow(source?: Draft) {
    if (pending || rows.length >= 100) return;
    const shared = sameSupplier
      ? {
          supplierId: rows[0].supplierId,
          mineId: sameMine ? rows[0].mineId : "",
        }
      : {};
    const values = source
      ? {
          customerId: source.customerId,
          supplierId: source.supplierId,
          mineId: source.mineId,
          vehicleNo: source.vehicleNo,
          weight: source.weight,
          purchaseRate: source.purchaseRate,
          sellRate: source.sellRate,
          notes: source.notes,
        }
      : shared;
    setRows((current) => [
      ...current.slice(0, 99),
      makeDraft(nextId.current++, values),
    ]);
    setCount(String(rows.length + 1));
  }

  function generateRows() {
    if (pending || !validRowCount) return;
    if (requestedRows < rows.length && dirty && !window.confirm(t.discardRows))
      return;
    const first = rows[0];
    const shared = sameSupplier
      ? { supplierId: first.supplierId, mineId: sameMine ? first.mineId : "" }
      : {};
    setRows(
      Array.from(
        { length: requestedRows },
        (_, index) => rows[index] ?? makeDraft(nextId.current++, shared),
      ),
    );
  }

  function clear() {
    if (dirty && !window.confirm(t.discard)) return;
    setRows([makeDraft(nextId.current++)]);
    setCount("1");
    setSameSupplier(false);
    setSameMine(false);
  }

  function setShared(kind: "supplier" | "mine", checked: boolean) {
    if (kind === "supplier") {
      setSameSupplier(checked);
      if (!checked) setSameMine(false);
    } else {
      setSameMine(checked);
      if (checked) setSameSupplier(true);
    }
    if (!checked) return;
    setRows((current) =>
      current.map((row) => ({
        ...row,
        supplierId: current[0].supplierId,
        mineId:
          kind === "mine" || row.supplierId !== current[0].supplierId
            ? current[0].mineId
            : row.mineId,
      })),
    );
  }

  const requestRows = rows.map((row) => ({
    customerId: row.customerId,
    supplierId: row.supplierId,
    mineId: row.mineId || undefined,
    vehicleNo: row.vehicleNo,
    weight: row.weight,
    sellRate: row.sellRate,
    biltyNo: row.biltyNo,
    notes: row.notes,
    confirmDuplicateVehicle: row.confirmDuplicateVehicle,
    confirmCreditLimit: row.confirmCreditLimit,
    ...(financial ? { purchaseRate: row.purchaseRate } : {}),
  }));

  function addParty(result: Awaited<ReturnType<typeof quickAddDispatchParty>>) {
    if (!quick) return;
    if (result.customer) {
      const created = result.customer;
      setCustomers((current) => [
        ...current.filter(({ id }) => id !== created.id),
        created,
      ]);
      updateRow(quick.localId, { customerId: created.id });
    } else if (result.supplier) {
      const created = result.supplier;
      setSuppliers((current) => [
        ...current.filter(({ id }) => id !== created.id),
        created,
      ]);
      updateRow(quick.localId, {
        supplierId: created.id,
        mineId: created.mines.find(({ isDefault }) => isDefault)?.id ?? "",
      });
    }
    setQuick(null);
  }

  return (
    <section
      className="rounded-[var(--radius)] border border-border bg-card"
      aria-labelledby="order-grid-title"
    >
      <form
        ref={batchForm}
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setSubmittedRows(rows.map(({ localId }) => localId));
          startTransition(() => action(form));
        }}
        aria-busy={pending}
        data-dirty={dirty || undefined}
        onKeyDown={(event) => {
          if ((event.altKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            addRow();
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
          <h2 id="order-grid-title" className="text-lg font-semibold">
            {t.newBatch}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={clear}
          >
            {t.clear}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 p-4 sm:p-5">
          <label className="grid gap-1 text-sm font-semibold">
            {t.entries}
            <input
              className={fieldClass}
              type="number"
              value={count}
              min={1}
              max={100}
              aria-describedby={rowCountId}
              aria-invalid={!validRowCount || undefined}
              onChange={(event) => setCount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.altKey && !event.ctrlKey) {
                  event.preventDefault();
                  generateRows();
                }
              }}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !validRowCount}
            onClick={generateRows}
          >
            {t.generate}
          </Button>
          <label className="grid gap-1 text-sm font-semibold">
            {t.date}
            <input
              className={fieldClass}
              type="date"
              value={date}
              disabled={dateLocked || pending}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="ms-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameSupplier}
                onChange={(event) =>
                  setShared("supplier", event.target.checked)
                }
              />
              {t.sameSupplier}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameMine}
                onChange={(event) => setShared("mine", event.target.checked)}
              />
              {t.sameMine}
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || rows.length >= 100}
              onClick={() => addRow(rows.at(-1))}
            >
              {t.copyDown}
            </Button>
          </div>
          <p
            id={rowCountId}
            aria-live="polite"
            className="basis-full text-sm text-muted-foreground"
          >
            {t.rowCount(rows.length)}
          </p>
        </div>
        <input
          type="hidden"
          name="batch"
          value={JSON.stringify({
            key: requestKey,
            businessDate: date,
            rows: requestRows,
          })}
          readOnly
        />
        {state.issues?.some(({ row }) => row !== undefined) && (
          <p
            role="alert"
            tabIndex={-1}
            data-batch-validation
            className="px-5 py-2 text-sm text-negative"
          >
            {t.reviewRows}
          </p>
        )}
        {state.issues
          ?.filter(({ row }) => row === undefined)
          .map(({ code }, index) => (
            <p
              key={index}
              role="alert"
              tabIndex={-1}
              data-batch-validation
              className="px-5 py-2 text-sm text-negative"
            >
              {t.errors[code]}
            </p>
          ))}
        <div className="grid gap-3 px-4 pb-4 sm:px-5">
          {rows.map((row, index) => {
            const mines =
              suppliers.find(({ id }) => id === row.supplierId)?.mines ?? [];
            const rendered = compute(row, financial);
            const problems =
              state.issues?.filter(
                (issue) =>
                  issue.row !== undefined &&
                  submittedRows[issue.row] === row.localId,
              ) ?? [];
            const issueFor = (field: string) =>
              problems.find((issue) => issue.field === field);
            const issueId = (key: keyof typeof t.fields) =>
              `${validationId}-${row.localId}-${key}`;
            const feedback = (key: keyof typeof t.fields) => ({
              "aria-invalid": Boolean(issueFor(key)),
              "aria-describedby": issueFor(key) ? issueId(key) : undefined,
            });
            const name = (field: keyof typeof t.fields) =>
              `${t.fields[field]} ${index + 1}`;
            const field = (key: keyof typeof t.fields, child: ReactNode) => {
              const issue = issueFor(key);
              return (
                <div className="grid min-w-0 content-start gap-1">
                  <span className="text-sm font-medium">
                    {t.fields[key]}
                    {key === "weight"
                      ? ` (${unit})`
                      : key === "purchaseRate" || key === "sellRate"
                        ? ` (${t.perWeight(unit)})`
                        : ""}
                  </span>
                  {child}
                  {issue && (
                    <span id={issueId(key)} className="text-xs text-negative">
                      {t.errors[issue.code]}
                    </span>
                  )}
                </div>
              );
            };
            const input = (
              key: keyof typeof t.fields,
              mode: "text" | "decimal" = "text",
              max = 64,
            ) =>
              field(
                key,
                <input
                  className={fieldClass}
                  value={row[key]}
                  aria-label={name(key)}
                  {...feedback(key)}
                  inputMode={mode}
                  maxLength={max}
                  disabled={pending}
                  onChange={(event) =>
                    updateRow(row.localId, { [key]: event.target.value })
                  }
                />,
              );
            return (
              <fieldset
                key={row.localId}
                className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-4"
                disabled={pending}
              >
                <legend className="px-2 text-sm font-semibold">
                  {t.row(index + 1)}
                </legend>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
                  {field(
                    "customerId",
                    <div className="flex min-w-0 gap-1.5">
                      <select
                        aria-label={name("customerId")}
                        {...feedback("customerId")}
                        className={fieldClass}
                        value={row.customerId}
                        onChange={(event) =>
                          updateRow(row.localId, {
                            customerId: event.target.value,
                          })
                        }
                      >
                        <option value="">{t.chooseCustomer}</option>
                        {customers.map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name}
                          </option>
                        ))}
                      </select>
                      {managesParties && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={t.addCustomer}
                          onClick={() =>
                            setQuick({ kind: "customer", localId: row.localId })
                          }
                        >
                          <Plus size={17} />
                        </Button>
                      )}
                    </div>,
                  )}
                  {field(
                    "supplierId",
                    <div className="flex min-w-0 gap-1.5">
                      <select
                        aria-label={name("supplierId")}
                        {...feedback("supplierId")}
                        className={fieldClass}
                        value={row.supplierId}
                        disabled={sameSupplier && index > 0}
                        onChange={(event) =>
                          changeSupplier(row.localId, event.target.value)
                        }
                      >
                        <option value="">{t.chooseSupplier}</option>
                        {suppliers.map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name}
                          </option>
                        ))}
                      </select>
                      {managesParties && (!sameSupplier || index === 0) && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={t.addSupplier}
                          onClick={() =>
                            setQuick({ kind: "supplier", localId: row.localId })
                          }
                        >
                          <Plus size={17} />
                        </Button>
                      )}
                    </div>,
                  )}
                  {field(
                    "mineId",
                    <select
                      aria-label={name("mineId")}
                      {...feedback("mineId")}
                      className={fieldClass}
                      value={row.mineId}
                      disabled={!row.supplierId || (sameMine && index > 0)}
                      onChange={(event) =>
                        updateRow(row.localId, { mineId: event.target.value })
                      }
                    >
                      <option value="">{t.chooseMine}</option>
                      {mines.map((mine) => (
                        <option key={mine.id} value={mine.id}>
                          {mine.code} · {mine.name}
                        </option>
                      ))}
                    </select>,
                  )}
                  {input("vehicleNo", "text", 40)}
                  {input("weight", "decimal")}
                  {financial && input("purchaseRate", "decimal")}
                  {input("sellRate", "decimal")}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm tabular-nums">
                  {financial && (
                    <span>
                      {t.buyAmount}{" "}
                      <strong>
                        {rendered
                          ? formatCurrency(rendered.buyAmount, preferences)
                          : "—"}
                      </strong>
                    </span>
                  )}
                  <span>
                    {t.sellAmount}{" "}
                    <strong>
                      {rendered
                        ? formatCurrency(rendered.sellAmount, preferences)
                        : "—"}
                    </strong>
                  </span>
                  {financial && (
                    <span>
                      {t.profit}{" "}
                      <strong>
                        {rendered
                          ? formatCurrency(rendered.profit, preferences)
                          : "—"}
                      </strong>
                    </span>
                  )}
                  <div className="ms-auto flex gap-1">
                    <Button
                      size="icon"
                      type="button"
                      variant="ghost"
                      disabled={rows.length >= 100}
                      aria-label={t.duplicateRow(index + 1)}
                      onClick={() => addRow(row)}
                    >
                      <Copy size={17} />
                    </Button>
                    <Button
                      size="icon"
                      type="button"
                      variant="ghost"
                      disabled={rows.length === 1}
                      aria-label={t.removeRow(index + 1)}
                      onClick={() => {
                        setRows((current) =>
                          current.filter(
                            (item) => item.localId !== row.localId,
                          ),
                        );
                        setCount(String(rows.length - 1));
                      }}
                    >
                      <X size={17} />
                    </Button>
                  </div>
                </div>
                <details
                  className="mt-2 text-sm"
                  open={
                    Boolean(issueFor("biltyNo") || issueFor("notes")) ||
                    undefined
                  }
                >
                  <summary className="cursor-pointer font-medium text-primary">
                    {t.details}
                  </summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {input("biltyNo", "text", 80)}
                    {input("notes", "text", 1500)}
                  </div>
                </details>
                {problems.some(({ code }) => code === "duplicateVehicle") && (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.confirmDuplicateVehicle}
                      onChange={(event) =>
                        updateRow(row.localId, {
                          confirmDuplicateVehicle: event.target.checked,
                        })
                      }
                    />
                    {t.confirmDuplicateVehicle}
                  </label>
                )}
                {problems.some(({ code }) => code === "creditLimit") && (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.confirmCreditLimit}
                      onChange={(event) =>
                        updateRow(row.localId, {
                          confirmCreditLimit: event.target.checked,
                        })
                      }
                    />
                    {t.confirmCreditLimit}
                  </label>
                )}
              </fieldset>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-4 text-sm sm:p-5">
          <strong>{t.totals}</strong>
          <span className="tabular-nums">
            {formatDecimal(weight.toString(), 3, preferences.numberFormat)}{" "}
            {unit}
          </span>
          {financial && (
            <span className="tabular-nums">
              {t.buyAmount} {formatCurrency(buy.toString(), preferences)}
            </span>
          )}
          <span className="tabular-nums">
            {t.sellAmount} {formatCurrency(sell.toString(), preferences)}
          </span>
          {financial && (
            <span className="tabular-nums">
              {t.profit} {formatCurrency(profit.toString(), preferences)}
            </span>
          )}
          <div className="ms-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending || rows.length >= 100}
              onClick={() => addRow()}
            >
              {t.addRow}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t.saving : t.save}
            </Button>
          </div>
        </div>
      </form>
      {quick && (
        <QuickParty
          kind={quick.kind}
          onClose={() => setQuick(null)}
          onAdded={addParty}
        />
      )}
    </section>
  );
}
