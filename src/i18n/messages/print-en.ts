export const documentPrint = {
  prepared: (name: string) => `Prepared by ${name}`,
  generated: (date: string) => `Generated ${date}`,
  page: (number: number, count: number) => `Page ${number} of ${count}`,
  unavailable: "The document is unavailable.",
  rateLimited: "Too many print requests. Try again in a few minutes.",
  missing: "-",
} as const;
