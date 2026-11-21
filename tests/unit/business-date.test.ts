import { describe, expect, it } from "vitest";
import {
  formatBusinessDate,
  parseBusinessDate,
  todayBusinessDate,
} from "../../src/domain/business-date";

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

describe("business date keys", () => {
  it("uses the local calendar date independently of the UTC day", () => {
    expect(todayBusinessDate(new Date("2026-12-31T19:00:00Z"))).toBe(
      "2027-01-01",
    );
  });

  it("parses an exact date-only value at UTC midnight", () => {
    expect(parseBusinessDate("2028-02-29").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it.each(["2027-02-29", "2027-04-31", "2027-1-01", "2027-01-01T00:00:00Z"])(
    "rejects invalid date input %s",
    (input) => {
      expect(() => parseBusinessDate(input)).toThrow(RangeError);
    },
  );
});
