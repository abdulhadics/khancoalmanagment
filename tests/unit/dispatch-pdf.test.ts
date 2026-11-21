import { describe, expect, it } from "vitest";

import type { DocumentProfile } from "../../src/server/documents/pdf";
import {
  renderDailyDispatch,
  renderDispatchSlip,
} from "../../src/server/orders/dispatch-pdf";
import type { DispatchSummaryRow } from "../../src/server/orders/print";
import { pdfResponse } from "../../src/server/orders/print-response";

const profile: DocumentProfile = {
  name: "Khan Coal Supplier",
  tagline: "Coal Supply Management",
  address: "Dispatch yard, Pakistan",
  email: "dispatch@example.test",
  phone: null,
  logoBytes: null,
  logoMediaType: null,
  currencySymbol: "Rs.",
  numberFormat: "en-PK",
  weightUnit: "TON",
  dateFormat: "dd MMM yyyy",
  footer: "Keep this copy with the dispatch record.",
};

const row: DispatchSummaryRow = {
  orderNo: "ORD-2026-0184",
  customer: "Industrial customer",
  supplier: "Coal supplier",
  mine: "Khyber Mine",
  vehicle: "PK-1834",
  status: "POSTED",
  weight: "38.250",
  financial: { buy: "144670.05", sell: "164400.50", profit: "19730.45" },
};
const document = {
  profile,
  generatedAt: new Date("2026-11-21T15:00:00Z"),
  preparedBy: "Dispatch Accountant",
  date: new Date("2026-11-21T00:00:00Z"),
};

function pageCount(body: Uint8Array): number {
  const text = Buffer.from(body).toString("latin1");
  expect(text).toMatch(/^%PDF-/);
  expect(text).toMatch(/%%EOF\s*$/u);
  return text.match(/\/Type \/Page\b/g)?.length ?? 0;
}

describe("dispatch documents", () => {
  it("renders a letterhead slip as one private inline PDF page", async () => {
    const body = await renderDispatchSlip({
      ...document,
      row,
      bilty: "BILTY-2026-101",
      notes: "Weighed at origin.",
    });
    expect(pageCount(body)).toBe(1);
    const response = pdfResponse(body, "dispatch-ORD-2026-0184");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="dispatch-ORD-2026-0184.pdf"',
    );
  });

  it("paginates the daily register with groups of long rows and a totals line", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      ...row,
      orderNo: `ORD-2026-${(index + 1).toString().padStart(4, "0")}`,
      customer: "A two-line industrial customer representative account",
    }));
    const body = await renderDailyDispatch({
      ...document,
      rows,
      financial: true,
      totals: {
        weight: "2295.000",
        buy: "8680203.00",
        sell: "9864030.00",
        profit: "1183827.00",
      },
    });
    expect(pageCount(body)).toBeGreaterThan(2);
  });

  it("renders empty day registers without a redundant page", async () => {
    const body = await renderDailyDispatch({
      ...document,
      rows: [],
      financial: false,
      totals: { weight: "0.000" },
    });
    expect(pageCount(body)).toBe(1);
  });
});
