import { describe, expect, it } from "vitest";

import { renderPaymentVoucher } from "../../src/server/account/voucher-pdf";
import type { VoucherDocument } from "../../src/server/account/voucher";

const voucher: VoucherDocument = {
  profile: {
    name: "Khan Coal Supplier",
    tagline: "Coal Supply Management",
    address: "Dispatch Yard, Pakistan",
    phone: null,
    email: null,
    logoMediaType: null,
    logoBytes: null,
    currencySymbol: "Rs.",
    weightUnit: "TON",
    dateFormat: "dd/MM/yyyy",
    numberFormat: "en-PK",
    footer: "Retain this with the account records.",
  },
  voucherNo: "VCH-000142",
  direction: "IN",
  status: "BOUNCED",
  method: "CHEQUE",
  party: { code: "CUS-001", name: "Ravi Industrial Metals Re-Rolling Works" },
  generatedAt: new Date("2026-11-23T08:30:00Z"),
  date: new Date("2026-11-21T00:00:00Z"),
  statusDate: new Date("2026-11-23T00:00:00Z"),
  preparedBy: "Dispatch Accountant",
  bankName: "Clearing Branch",
  referenceNo: "CHQ-2577",
  amount: "1498220.00",
  notes: "Submitted against the customer's outstanding balance.",
};

describe("voucher documents", () => {
  it.each([
    {
      direction: "IN",
      status: "BOUNCED",
      method: "CHEQUE",
      title: "Receipt voucher",
    },
    {
      direction: "OUT",
      status: "POSTED",
      method: "BANK_TRANSFER",
      title: "Payment voucher",
    },
  ] as const)(
    "prints the $title on one page",
    async ({ direction, status, method, title }) => {
      const bytes = await renderPaymentVoucher({
        ...voucher,
        direction,
        status,
        method,
      });
      const content = Buffer.from(bytes).toString("latin1");
      expect(content).toMatch(/^%PDF-/);
      expect(content).toMatch(/%%EOF\s*$/u);
      expect(content.match(/\/Type \/Page\b/g)).toHaveLength(1);
      expect(content).toContain(`${title} - VCH-000142`);
    },
  );
});
