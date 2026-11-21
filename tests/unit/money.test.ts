import { describe, expect, it } from "vitest";

import {
  calculateOrderAmounts,
  parseMoney,
  parseRate,
  parseWeight,
} from "../../src/domain/money";

describe("decimal boundaries", () => {
  it("preserves signed money exactly", () => {
    expect(parseMoney("-999999999999.99").toFixed(2)).toBe("-999999999999.99");
    expect(parseMoney("19.90").plus("0.11").toFixed(2)).toBe("20.01");
    expect(parseMoney("0").toFixed(2)).toBe("0.00");
  });

  it.each([
    "",
    "NaN",
    "Infinity",
    "1e3",
    "1,250.01",
    " 1.00",
    "42.",
    "1\n",
    "0".repeat(65),
  ])("rejects unsupported decimal input %j", (value) => {
    expect(() => parseMoney(value)).toThrow(/decimal string/);
  });

  it("rejects excess scale and amounts outside the database range", () => {
    expect(() => parseMoney("0.100")).toThrow(/at most 2/);
    expect(() => parseMoney("1000000000000")).toThrow(/supported range/);
    expect(() => parseMoney("-1000000000000")).toThrow(/supported range/);
  });

  it("requires positive weight with three fractional places of precision", () => {
    expect(parseWeight("999999999.999").toFixed(3)).toBe("999999999.999");
    expect(() => parseWeight("1000000000")).toThrow(/supported range/);
    expect(() => parseWeight("0.000")).toThrow(/positive/);
    expect(() => parseWeight("-0.001")).toThrow(/positive/);
    expect(() => parseWeight("0.0001")).toThrow(/at most 3/);
  });

  it("allows zero rates and bounds precision and sign", () => {
    expect(parseRate("9999999999.99").toFixed(2)).toBe("9999999999.99");
    expect(parseRate("0.00").isZero()).toBe(true);
    expect(() => parseRate("10000000000")).toThrow(/supported range/);
    expect(() => parseRate("-0.01")).toThrow(/non-negative/);
    expect(() => parseRate("0.001")).toThrow(/at most 2/);
  });
});

describe("calculateOrderAmounts", () => {
  it("rounds each extended amount half up and subtracts the snapshots", () => {
    expect(
      calculateOrderAmounts({
        weight: "10.005",
        purchaseRate: "3.00",
        sellRate: "3.01",
      }),
    ).toEqual({ buyAmount: "30.02", sellAmount: "30.12", profit: "0.10" });
  });

  it("preserves a loss when only one rounded amount reaches a cent", () => {
    expect(
      calculateOrderAmounts({
        weight: "0.005",
        purchaseRate: "1.00",
        sellRate: "0.99",
      }),
    ).toEqual({ buyAmount: "0.01", sellAmount: "0.00", profit: "-0.01" });
  });

  it("keeps large supported values exact", () => {
    expect(
      calculateOrderAmounts({
        weight: "999999999.999",
        purchaseRate: "1000.00",
        sellRate: "0",
      }),
    ).toEqual({
      buyAmount: "999999999999.00",
      sellAmount: "0.00",
      profit: "-999999999999.00",
    });
  });

  it("rejects a rounded snapshot that would overflow the database", () => {
    expect(() =>
      calculateOrderAmounts({
        weight: "999999999.999",
        purchaseRate: "1000.01",
        sellRate: "0.00",
      }),
    ).toThrow(/Buy amount is outside/);
    expect(() =>
      calculateOrderAmounts({
        weight: "999999999.999",
        purchaseRate: "0.00",
        sellRate: "1000.01",
      }),
    ).toThrow(/Sell amount is outside/);
  });
});
