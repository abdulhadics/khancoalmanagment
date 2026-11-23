import { describe, expect, it } from "vitest";
import {
  can,
  canAccessOrder,
  canCreateOrder,
  PermissionDenied,
  requirePermission,
} from "../../src/domain/permissions";

describe("role permissions", () => {
  it("limits privileged actions and denies unknown actions by default", () => {
    expect(can("OWNER", "staff.manage")).toBe(true);
    expect(can("ACCOUNTANT", "orders.post")).toBe(true);
    expect(can("ACCOUNTANT", "parties.openingBalance")).toBe(false);
    expect(can("ACCOUNTANT", "orders.void")).toBe(false);
    expect(can("OPERATOR", "account.manage")).toBe(false);
    expect(can("OPERATOR", "dashboard.financial")).toBe(false);
    expect(can("OPERATOR", "orders.financial")).toBe(false);
    expect(can("OPERATOR", "reports.view")).toBe(false);
    expect(can("VIEWER", "reports.view")).toBe(true);
    expect(can("VIEWER", "reports.export")).toBe(false);
    expect(can("VIEWER", "orders.create")).toBe(false);
    expect(can("VIEWER", "account.view")).toBe(false);
    expect(can("ACCOUNTANT", "expenses.manage")).toBe(true);
    expect(can("OPERATOR", "expenses.manage")).toBe(false);
    expect(can("OWNER", "expenses.void")).toBe(true);
    expect(can("ACCOUNTANT", "expenses.void")).toBe(false);
    expect(can("OPERATOR", "deliveries.manage")).toBe(true);
    expect(can("VIEWER", "deliveries.manage")).toBe(false);
    expect(can("VIEWER", "notifications.view")).toBe(true);
    expect(can("OWNER", "toString")).toBe(false);
    expect(can("unrecognized", "dashboard.view")).toBe(false);
    expect(() =>
      requirePermission(
        { userId: "1", roleCode: "ACCOUNTANT" },
        "staff.manage",
      ),
    ).toThrow(PermissionDenied);
  });

  it("keeps Operator changes and duplication within their own current business day", () => {
    const actor = { userId: "operator", roleCode: "OPERATOR" } as const;
    const today = "2026-11-21";
    const own = {
      createdById: actor.userId,
      businessDate: today,
      status: "PENDING_PRICING",
    } as const;
    const prior = { ...own, businessDate: "2026-11-20" };
    const otherStaff = { ...own, createdById: "someone-else" };
    const posted = { ...own, status: "POSTED" } as const;

    expect(canAccessOrder(actor, "orders.editPending", own, today)).toBe(true);
    expect(canAccessOrder(actor, "orders.editPending", posted, today)).toBe(
      false,
    );
    expect(canAccessOrder(actor, "orders.editMetadata", posted, today)).toBe(
      true,
    );
    expect(canAccessOrder(actor, "orders.post", own, today)).toBe(false);
    expect(canAccessOrder(actor, "orders.print", otherStaff, today)).toBe(
      false,
    );
    expect(canAccessOrder(actor, "orders.view", prior, today)).toBe(false);
    expect(canCreateOrder(actor, today, today, own)).toBe(true);
    expect(canCreateOrder(actor, today, today, otherStaff)).toBe(false);
    expect(canCreateOrder(actor, prior.businessDate, today)).toBe(false);
  });
});
