"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { orders as t } from "@/i18n/messages/orders-en";
import type { DispatchOptions, DispatchOrder } from "@/server/orders/workspace";
import { submitOrderEdit } from "../../actions";
import type { EditMode } from "../../form-state";

const inputClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm aria-invalid:border-negative";

export function OrderEditForm({
  order,
  mode,
  requestKey,
  lockedDate,
  options,
}: {
  order: DispatchOrder;
  mode: EditMode;
  requestKey: string;
  lockedDate: boolean;
  options: DispatchOptions;
}) {
  const [state, action, pending] = useActionState(
    submitOrderEdit.bind(null, order.id, mode),
    {},
  );
  const [date, setDate] = useState(order.businessDate);
  const [supplierId, setSupplier] = useState(order.supplierId);
  const [mineId, setMine] = useState(order.mineId);
  const [dirty, setDirty] = useState(false);
  const full = !["metadata", "void"].includes(mode);
  const voiding = mode === "void";
  const pricing = mode === "price" || mode === "correct";
  const active = options.suppliers.find(
    (supplier) => supplier.id === supplierId,
  );

  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  function field(
    name: keyof typeof t.fields,
    value: string,
    maxLength: number,
    decimal = false,
    required = true,
  ) {
    return (
      <label className="grid min-w-0 gap-1 text-sm font-semibold">
        {t.fields[name]}
        <input
          name={name}
          defaultValue={value}
          maxLength={maxLength}
          required={required}
          inputMode={decimal ? "decimal" : "text"}
          className={inputClass}
          aria-invalid={state.issue?.field === name || undefined}
        />
      </label>
    );
  }

  return (
    <form
      method="post"
      data-dirty={dirty || undefined}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}
      aria-busy={pending}
      className="max-w-4xl"
    >
      <input
        name="revisionNo"
        type="hidden"
        value={order.revisionNo}
        readOnly
      />
      <input name="key" type="hidden" value={requestKey} readOnly />
      <input name="returnDate" type="hidden" value={date} readOnly />
      {full && lockedDate && (
        <input name="businessDate" type="hidden" value={date} readOnly />
      )}
      <fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
        {full && !lockedDate && (
          <label className="grid gap-1 text-sm font-semibold">
            {t.date}
            <input
              name="businessDate"
              type="date"
              className={inputClass}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
        )}
        {full && (
          <>
            <label className="grid gap-1 text-sm font-semibold">
              <span>{t.fields.customerId}</span>
              <select
                name="customerId"
                defaultValue={order.customerId}
                className={inputClass}
                required
                aria-invalid={state.issue?.field === "customerId" || undefined}
              >
                {!options.customers.some(
                  ({ id }) => id === order.customerId,
                ) && <option value={order.customerId}>{order.customer}</option>}
                {options.customers.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              <span>{t.fields.supplierId}</span>
              <select
                name="supplierId"
                value={supplierId}
                className={inputClass}
                required
                onChange={(event) => {
                  const id = event.target.value;
                  setSupplier(id);
                  setMine(
                    options.suppliers
                      .find((supplier) => supplier.id === id)
                      ?.mines.find(({ isDefault }) => isDefault)?.id ?? "",
                  );
                }}
              >
                {!options.suppliers.some(
                  ({ id }) => id === order.supplierId,
                ) && <option value={order.supplierId}>{order.supplier}</option>}
                {options.suppliers.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              <span>{t.fields.mineId}</span>
              <select
                name="mineId"
                value={mineId}
                className={inputClass}
                onChange={(event) => setMine(event.target.value)}
                required
              >
                <option value="">{t.chooseMine}</option>
                {supplierId === order.supplierId &&
                  !active?.mines.some(({ id }) => id === order.mineId) && (
                    <option value={order.mineId}>{order.mine}</option>
                  )}
                {active?.mines.map(({ id, code, name }) => (
                  <option key={id} value={id}>
                    {code} · {name}
                  </option>
                ))}
              </select>
            </label>
            {field("weight", order.weight, 64, true)}
            {pricing &&
              field("purchaseRate", order.purchaseRate ?? "", 64, true)}
            {field("sellRate", order.sellRate, 64, true)}
          </>
        )}
        {!voiding && (
          <>
            {field("vehicleNo", order.vehicleNo, 40)}
            {field("biltyNo", order.biltyNo, 80, false, false)}
            <label className="grid min-w-0 gap-1 text-sm font-semibold md:col-span-2">
              {t.fields.notes}
              <textarea
                name="notes"
                maxLength={1500}
                rows={3}
                defaultValue={order.notes}
                className={`${inputClass} py-2`}
              />
            </label>
          </>
        )}
        {(voiding || mode === "correct") && (
          <label className="grid min-w-0 gap-1 text-sm font-semibold md:col-span-2">
            {voiding ? t.voidReason : t.postedReason}
            <textarea
              name="reason"
              maxLength={500}
              required={voiding}
              rows={3}
              className={`${inputClass} py-2`}
            />
          </label>
        )}
        {state.issue?.code === "duplicateVehicle" && (
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="confirmDuplicateVehicle" />
            {t.confirmDuplicateVehicle}
          </label>
        )}
        {state.issue?.code === "creditLimit" && (
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="confirmCreditLimit" />
            {t.confirmCreditLimit}
          </label>
        )}
      </fieldset>
      {state.issue && (
        <p className="mt-4 text-sm text-negative" role="alert">
          {t.errors[state.issue.code]}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          type="submit"
          disabled={pending}
          className={voiding ? "bg-negative hover:bg-negative/90" : undefined}
        >
          {pending
            ? t.saving
            : voiding
              ? t.void
              : mode === "price"
                ? t.postOrder
                : t.saveChanges}
        </Button>
        <Button asChild variant="outline">
          <Link
            href={`/orders?date=${order.businessDate}`}
            onClick={(event) => {
              if (dirty && !window.confirm(t.discard)) event.preventDefault();
            }}
          >
            {t.cancel}
          </Link>
        </Button>
      </div>
    </form>
  );
}
