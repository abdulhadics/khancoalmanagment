import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import {
  ReportPeriodError,
  resolveReportPeriod,
  type ReportPeriod,
} from "../reporting/period";

export const dashboardPeriods = [
  "today",
  "week",
  "month",
  "year",
  "all",
  "custom",
] as const;

export type DashboardPeriod = (typeof dashboardPeriods)[number];
export type DashboardFilters = { period?: string } & ReportPeriod;
export type DashboardBounds = ReportPeriod & { to: string };

export class DashboardPeriodError extends Error {
  constructor(readonly field: "period" | "from" | "to") {
    super("Invalid dashboard period.");
    this.name = "DashboardPeriodError";
  }
}

type Preset = Exclude<DashboardPeriod, "custom">;
type ParsedDashboardFilters = {
  today: string;
  period: DashboardPeriod;
  bounds: DashboardBounds;
  presets: Record<Preset, DashboardBounds>;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dashboardPresetBounds(
  today: string,
): Record<Preset, DashboardBounds> {
  const monday = parseBusinessDate(today);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return {
    today: { from: today, to: today },
    week: { from: dateKey(monday), to: today },
    month: { from: `${today.slice(0, 7)}-01`, to: today },
    year: { from: `${today.slice(0, 4)}-01-01`, to: today },
    all: { to: today },
  };
}

export function parseDashboardFilters(
  filters: DashboardFilters = {},
  now = new Date(),
): ParsedDashboardFilters {
  const today = todayBusinessDate(now);
  const presets = dashboardPresetBounds(today);
  const { period = "month", from, to } = filters;
  if (period !== "custom") {
    const selected = dashboardPeriods.find((option) => option === period);
    if (selected === undefined || selected === "custom")
      throw new DashboardPeriodError("period");
    return { today, period: selected, bounds: presets[selected], presets };
  }
  if (!from) throw new DashboardPeriodError("from");
  if (!to) throw new DashboardPeriodError("to");
  try {
    resolveReportPeriod({ from, to }, now);
  } catch (error) {
    if (!(error instanceof ReportPeriodError)) throw error;
    throw new DashboardPeriodError(error.field === "from" ? "from" : "to");
  }
  return { today, period, bounds: { from, to }, presets };
}

export function chartMonths(through: string) {
  const end = parseBusinessDate(through);
  const year = end.getUTCFullYear();
  const monthIndex = end.getUTCMonth();
  return Array.from({ length: 12 }, (_, index) =>
    dateKey(new Date(Date.UTC(year, monthIndex - 11 + index, 1))).slice(0, 7),
  );
}
