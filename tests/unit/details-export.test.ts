import { describe, expect, it } from "vitest";

import { csvDecimal, renderCsv } from "../../src/server/documents/csv";
import { renderTablePdf } from "../../src/server/documents/pdf-table";
import { csvResponse } from "../../src/server/documents/print-response";

describe("CSV exports", () => {
  it("neutralizes formula-like text, escapes quoted fields, and preserves exact decimals", () => {
    const bytes = renderCsv(
      ["Party", "Reference", "Profit"],
      [
        ["=record", 'Ref "ABC", Main\r\nBranch', csvDecimal("-1498220.07")],
        [" \t+note", "\uFEFF＠record", csvDecimal("30.02")],
        ["-report", "@account", null],
        ["Ordinary name", "001-AB", csvDecimal("0.00")],
      ],
    );
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(new TextDecoder().decode(bytes)).toBe(
      '"Party","Reference","Profit"\r\n' +
        '"\t=record","Ref ""ABC"", Main\r\nBranch",-1498220.07\r\n' +
        '"\t \t+note","\t\uFEFF＠record",30.02\r\n' +
        '"\t-report","\t@account",""\r\n' +
        '"Ordinary name","001-AB",0.00\r\n',
    );
    const response = csvResponse(bytes, "ledger-test");
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8; header=present",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="ledger-test.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("rejects malformed internal decimal cells and inconsistent row widths", () => {
    expect(() =>
      renderCsv(["Amount"], [[csvDecimal("+not-a-decimal")]]),
    ).toThrow(/decimal/);
    expect(() => renderCsv(["Amount", "Bank"], [[csvDecimal("1.20")]])).toThrow(
      /column count/,
    );
  });
});

describe("detail export PDF tables", () => {
  it("paginates long tables and makes room for two-line cells and total rows", async () => {
    const bytes = await renderTablePdf({
      profile: {
        name: "Khan Coal Supplier",
        tagline: null,
        address: null,
        phone: null,
        email: null,
        logoBytes: null,
        logoMediaType: null,
        currencySymbol: "Rs.",
        weightUnit: "TON",
        dateFormat: "dd MMM yyyy",
        numberFormat: "en-PK",
        footer: "Filed with the ledger",
      },
      generatedAt: new Date("2026-11-23T10:00:00Z"),
      preparedBy: "Accountant",
      title: "Sales Details",
      subtitle: "November 2026",
      columns: [
        { label: "Order", weight: 1, singleLine: true },
        { label: "Parties", weight: 2 },
        { label: "Rate / amount", weight: 1, number: true },
      ],
      rows: Array.from({ length: 52 }, (_, index) => [
        `ORD-2026-${String(index + 1).padStart(4, "0")}`,
        ["Industrial Metals Re-Rolling Works", "Coal Supply Cooperative"],
        ["22,850.00", "914,000.00"],
      ]),
      totalRows: [["Total", "", "47,528,000.00"]],
      emptyMessage: "No matching records.",
    });
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf).toMatch(/^%PDF-/);
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(2);
    expect(pdf).toContain("Sales Details");
  });
});
