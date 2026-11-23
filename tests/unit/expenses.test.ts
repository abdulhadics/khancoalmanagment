import { describe, expect, it } from "vitest";
import { ExpenseCommandError } from "../../src/server/expenses/mutations";

describe("expense command errors and categories", () => {
  it("creates structured error instances with codes and fields", () => {
    const error = new ExpenseCommandError("invalid", "amount");
    expect(error.code).toBe("invalid");
    expect(error.field).toBe("amount");
    expect(error.name).toBe("ExpenseCommandError");
  });

  it("identifies locked period error code", () => {
    const error = new ExpenseCommandError("closed", "businessDate");
    expect(error.code).toBe("closed");
  });
});
