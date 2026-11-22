export const salesPartyFilter = {
  customer: { choose: "Choose customer", search: "Customer name or code" },
  supplier: { choose: "Choose supplier", search: "Supplier name or code" },
  close: "Close",
  searching: "Searching…",
  empty: "No matches. Try a different name or code.",
  matches: (count: number) =>
    count === 1 ? "One matching result." : `${count} matching results.`,
  more: "Search by name or code to narrow these results.",
  error: "Results could not load. Try again.",
  retry: "Retry",
} as const;
