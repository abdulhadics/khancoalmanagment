const businessDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const businessDateKeyFormatter = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Karachi",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatBusinessDate(date: Date): string {
  return businessDateFormatter.format(date);
}

export function todayBusinessDate(instant = new Date()): string {
  const parts = businessDateKeyFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RangeError("Invalid business date.");
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

export function parseBusinessDate(value: string): Date {
  if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    throw new RangeError("Business date must use YYYY-MM-DD.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Invalid business date.");
  }
  return date;
}
