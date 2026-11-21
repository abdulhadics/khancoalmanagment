import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../domain/business-date";
import { Prisma } from "../../generated/prisma/client";

export type ReportPeriod = { from?: string; to?: string };
type PeriodInput = ReportPeriod & {
  year?: string | number;
  month?: string | number;
};

export class ReportPeriodError extends Error {
  constructor(readonly field: "year" | "month" | "from" | "to") {
    super("Invalid report period.");
    this.name = "ReportPeriodError";
  }
}

function selectedInteger(
  raw: string | number | undefined,
  field: "year" | "month",
  minimum: number,
  maximum: number,
) {
  if (raw === undefined || raw === "") return undefined;
  const value = String(raw);
  if (!/^\d+$/.test(value)) throw new ReportPeriodError(field);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ReportPeriodError(field);
  }
  return parsed;
}

function selectedDate(raw: string | undefined, field: "from" | "to") {
  if (!raw) return undefined;
  try {
    parseBusinessDate(raw);
    return raw;
  } catch {
    throw new ReportPeriodError(field);
  }
}

export function resolveReportPeriod(
  { year: rawYear, month: rawMonth, from: rawFrom, to: rawTo }: PeriodInput,
  now = new Date(),
): ReportPeriod {
  const month = selectedInteger(rawMonth, "month", 1, 12);
  const year =
    selectedInteger(rawYear, "year", 1000, 9999) ??
    (month === undefined
      ? undefined
      : Number(todayBusinessDate(now).slice(0, 4)));
  let from = selectedDate(rawFrom, "from");
  let to = selectedDate(rawTo, "to");
  if (year !== undefined) {
    const monthText = String(month ?? 1).padStart(2, "0");
    const start = `${year}-${monthText}-01`;
    const endMonth = month ?? 12;
    const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const end = `${year}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
    if (!from || from < start) from = start;
    if (!to || to > end) to = end;
  }
  if (from && to && from > to) throw new ReportPeriodError("to");
  return { from, to };
}

// Compared to DATE values with an exclusive upper bound including every
// posting on the selected final business day.
export function businessDateConditions(
  column: Prisma.Sql,
  { from, to }: ReportPeriod,
) {
  return [
    from ? Prisma.sql`${column} >= ${from}::date` : undefined,
    to ? Prisma.sql`${column} < (${to}::date + 1)` : undefined,
  ].filter((condition): condition is Prisma.Sql => condition !== undefined);
}
