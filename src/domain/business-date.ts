const businessDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatBusinessDate(date: Date): string {
  return businessDateFormatter.format(date);
}
