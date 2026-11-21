export const partyReports = {
  customer: {
    title: "Customers Report",
    single: "Single Customer Report",
    entity: "Customer",
    billed: "Period sales",
    settled: "Receipts",
    due: "Closing receivable",
    action: "Receive",
  },
  supplier: {
    title: "Suppliers Report",
    single: "Single Supplier Report",
    entity: "Supplier",
    billed: "Period purchases",
    settled: "Payments",
    due: "Closing payable",
    action: "Pay",
  },
  search: "Search parties",
  searchPlaceholder: "Name or code",
  trucks: "Trucks",
  total: "Totals",
  ledger: "Ledger",
  view: "View",
  noResults: "No parties match this report.",
  page: (page: number, total: number, parties: number) =>
    `Page ${page} of ${total} · ${parties} ${parties === 1 ? "party" : "parties"}`,
} as const;
