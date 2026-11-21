import { ledgerMessages as t } from "@/i18n/messages/ledger-en";

const inputClass =
  "min-h-10 min-w-0 rounded-lg border border-border bg-card px-3 text-sm";
type Fields = { year?: string; month?: string; from?: string; to?: string };

function PeriodInput({
  id,
  label,
  name,
  value,
  type,
}: {
  id: string;
  label: string;
  name: string;
  value?: string;
  type: "number" | "date";
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        type={type}
        name={name}
        defaultValue={value ?? ""}
        min={type === "number" ? 1000 : undefined}
        max={type === "number" ? 9999 : undefined}
        className={`${inputClass} w-full`}
      />
    </div>
  );
}

export function ReportPeriodFields({
  prefix,
  fields,
}: {
  prefix: string;
  fields: Fields;
}) {
  return (
    <>
      <PeriodInput
        id={`${prefix}-year`}
        label={t.year}
        name="year"
        value={fields.year}
        type="number"
      />
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${prefix}-month`} className="text-sm font-semibold">
          {t.month}
        </label>
        <select
          id={`${prefix}-month`}
          name="month"
          defaultValue={fields.month ? String(Number(fields.month)) : ""}
          className={inputClass}
        >
          <option value="">{t.allMonths}</option>
          {t.months.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <PeriodInput
        id={`${prefix}-from`}
        label={t.from}
        name="from"
        value={fields.from}
        type="date"
      />
      <PeriodInput
        id={`${prefix}-to`}
        label={t.to}
        name="to"
        value={fields.to}
        type="date"
      />
    </>
  );
}
