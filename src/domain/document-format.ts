import { formatBusinessDate } from "./business-date";

export const documentDateFormats = [
  "dd MMM yyyy",
  "dd/MM/yyyy",
  "yyyy-MM-dd",
] as const;

export const documentNumberFormats = ["en-PK", "en-IN"] as const;

const numericalDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDocumentDate(instant: Date, format: string): string {
  if (format === "dd/MM/yyyy") return numericalDate.format(instant);
  if (format === "yyyy-MM-dd") {
    const parts = numericalDate.formatToParts(instant);
    const year = parts.find(({ type }) => type === "year")?.value;
    const month = parts.find(({ type }) => type === "month")?.value;
    const day = parts.find(({ type }) => type === "day")?.value;
    return `${year}-${month}-${day}`;
  }
  return formatBusinessDate(instant);
}
