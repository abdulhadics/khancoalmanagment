import { describe, expect, it } from "vitest";

import type { ExportDocumentMetadata } from "../../src/server/documents/filtered-export";
import {
  renderPartySummaryPdf,
  renderSalesReportPdf,
} from "../../src/server/reporting/exports";
import { parsePartySummaryFilters } from "../../src/server/reporting/party-summary";
import { parseSalesReportFilters } from "../../src/server/reporting/sales-report";

const metadata: ExportDocumentMetadata = {
  profile: {
    name: "Khan Coal Supplier",
    tagline: "Coal Supply Management",
    address: null,
    phone: null,
    email: null,
    logoBytes: null,
    logoMediaType: null,
    dateFormat: "dd MMM yyyy",
    numberFormat: "en-PK",
    currencySymbol: "Rs.",
    weightUnit: "TON",
    footer: null,
  },
  preparedBy: "Accountant",
  generatedAt: new Date("2026-11-23T10:30:00Z"),
};

function checkPdf(body: Uint8Array, title: string) {
  const text = Buffer.from(body).toString("latin1");
  expect(text).toMatch(/^%PDF-/);
  expect(text).toContain(title);
  expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
}

describe("financial report PDF templates", () => {
  it("renders a grouped Sales Report with its exact aggregate row", async () => {
    const totals = {
      trucks: 1,
      weight: "10.005",
      sales: "30.12",
      purchases: "30.02",
      profit: "0.10",
    };
    const filters = parseSalesReportFilters({
      year: "2026",
      month: "11",
      groupBy: "mine",
    });
    checkPdf(
      await renderSalesReportPdf(
        {
          filters,
          total: 1,
          page: 1,
          pages: 1,
          totals,
          rows: [
            {
              key: "sample-mine",
              label: "M-07 - Sample Mine",
              businessDate: null,
              customer: null,
              supplier: "Sample Coal",
              mine: "M-07",
              vehicleNo: null,
              ...totals,
            },
          ],
        },
        metadata,
      ),
      "Sales Report",
    );
  });

  it.each([
    ["customer", "Customers Report"],
    ["supplier", "Suppliers Report"],
  ] as const)(
    "renders the %s summary with opening, adjustments and closing",
    async (kind, title) => {
      const totals = {
        trucks: 1,
        weight: "8.550",
        openingBalance: "100.00",
        billed: "40.00",
        settled: "10.00",
        adjustments: "-5.00",
        activity: "25.00",
        closingBalance: "125.00",
        pending: "125.00",
        advance: "0.00",
      };
      const filters = parsePartySummaryFilters(
        { from: "2026-11-01", to: "2026-11-30" },
        metadata.generatedAt,
      );
      checkPdf(
        await renderPartySummaryPdf(
          kind,
          {
            filters,
            preferences: metadata.profile,
            totals,
            page: 1,
            lastPage: 1,
            matchedCount: 1,
            rows: [
              {
                id: "sample-party",
                code: "SAMPLE-01",
                name: "Sample Industries",
                isActive: true,
                ...totals,
              },
            ],
          },
          metadata,
        ),
        title,
      );
    },
  );
});
