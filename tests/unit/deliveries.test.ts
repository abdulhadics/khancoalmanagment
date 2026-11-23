import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { DeliveryCommandError } from "../../src/server/deliveries/mutations";

describe("delivery tracking calculation and errors", () => {
  it("creates structured error instances with codes and fields", () => {
    const error = new DeliveryCommandError("excessWeight", "weight");
    expect(error.code).toBe("excessWeight");
    expect(error.field).toBe("weight");
    expect(error.name).toBe("DeliveryCommandError");
  });

  it("calculates remaining weight and completion accurately", () => {
    const ordered = new Decimal("50.000");
    const firstPickup = new Decimal("20.000");
    const remainingAfterFirst = ordered.minus(firstPickup);
    expect(remainingAfterFirst.toFixed(3)).toBe("30.000");

    const secondPickup = new Decimal("30.000");
    const remainingAfterSecond = remainingAfterFirst.minus(secondPickup);
    expect(remainingAfterSecond.toFixed(3)).toBe("0.000");
    expect(remainingAfterSecond.lte(0)).toBe(true);
  });
});
