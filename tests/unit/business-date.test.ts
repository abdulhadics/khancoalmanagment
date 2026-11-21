import { describe, expect, it } from "vitest";
import { formatBusinessDate } from "../../src/domain/business-date";

describe("formatBusinessDate", () => {
  it("formats an instant as the business date in Karachi", () => {
    expect(formatBusinessDate(new Date("2026-11-20T05:30:00.000Z"))).toBe(
      "20 Nov 2026",
    );
  });

  it("rolls over at local midnight independently of the host time zone", () => {
    expect(formatBusinessDate(new Date("2026-12-31T18:59:59.999Z"))).toBe(
      "31 Dec 2026",
    );
    expect(formatBusinessDate(new Date("2026-12-31T19:00:00.000Z"))).toBe(
      "01 Jan 2027",
    );
  });
});
