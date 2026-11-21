import { describe, expect, it } from "vitest";
import { formatCurrency, formatDecimal } from "../../src/domain/number-display";

describe("exact financial display", () => {
  it("keeps full precision in grouped totals", () => {
    expect(formatCurrency("9007199254740993.25")).toBe(
      "Rs.\u00a09,007,199,254,740,993.25",
    );
  });

  it("honors the company currency symbol and grouping preference", () => {
    expect(
      formatCurrency("1498220.00", {
        currencySymbol: "PKR",
        numberFormat: "en-IN",
      }),
    ).toBe("PKR\u00a014,98,220.00");
  });

  it("uses the requested scale and preserves a negative fractional balance", () => {
    expect(formatDecimal("-0.25", 2)).toBe("-0.25");
    expect(formatDecimal("54.02", 3)).toBe("54.020");
    expect(formatDecimal(500000n, 0)).toBe("500,000");
  });
});
