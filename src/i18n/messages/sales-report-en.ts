export const salesReportMessages = {
  title: "Sales Report",
  description:
    "Analyse posted dispatches by entry, date, customer, supplier, or mine.",
  groupBy: "Group by",
  groups: {
    entry: "Entry",
    date: "Date",
    customer: "Customer",
    supplier: "Supplier",
    mine: "Mine",
  },
  groupColumn: {
    entry: "Order no.",
    date: "Date",
    customer: "Customer",
    supplier: "Supplier",
    mine: "Mine",
  },
  grandTotal: "Grand total",
  empty: "No sales activity matches these filters.",
  emptyHelp: "Choose another period, customer, or supplier.",
  page: (page: number, pages: number, count: number) =>
    `Page ${page} of ${pages} · ${count} ${count === 1 ? "result" : "results"}`,
} as const;
