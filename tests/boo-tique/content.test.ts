import { describe, it, expect } from "vitest";
import { DEMO_VALID_UNTIL, FIXED_SALE_TEXT } from "@/lib/boo-tique/content";

const MONTHS: Readonly<Record<string, string>> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const SALE_PATTERN = /^Winter sale ends (\d{1,2}) ([A-Z][a-z]{2}) (\d{4}), 23:59 UTC$/;

/**
 * Parses the sale text into a zero-padded ISO date (YYYY-MM-DD).
 * Throws a message that shows the text when it does not match the pattern
 * or the month is not one of Jan to Dec. Never reads the clock.
 */
function saleIsoDate(text: string): string {
  const match = SALE_PATTERN.exec(text);
  if (!match) {
    throw new Error(`Sale text does not match the expected pattern: "${text}"`);
  }
  const [, day, monthName, year] = match;
  const month = MONTHS[monthName];
  if (!month) {
    throw new Error(`Sale text has an unknown month "${monthName}": "${text}"`);
  }
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/** True when the sale date in `text` is strictly later than `validUntil`. */
function isLaterThan(text: string, validUntil: string): boolean {
  return saleIsoDate(text) > validUntil;
}

describe("fixed sale content", () => {
  it("exports the exact fixed sale text", () => {
    expect(FIXED_SALE_TEXT).toBe("Winter sale ends 28 Feb 2027, 23:59 UTC");
  });

  it("exports the build-time valid-until constant", () => {
    expect(DEMO_VALID_UNTIL).toBe("2027-01-31");
  });

  it("shows a sale date strictly later than DEMO_VALID_UNTIL", () => {
    expect(saleIsoDate(FIXED_SALE_TEXT)).toBe("2027-02-28");
    expect(isLaterThan(FIXED_SALE_TEXT, DEMO_VALID_UNTIL)).toBe(true);
  });
});

describe("fixed sale date guard helper", () => {
  it("throws for a text that does not match the pattern", () => {
    expect(() => saleIsoDate("Sale ends soon")).toThrow(/Sale ends soon/);
  });

  it("throws for an unknown month", () => {
    expect(() => saleIsoDate("Winter sale ends 28 Foo 2027, 23:59 UTC")).toThrow(
      /Foo/,
    );
  });

  it("throws for the old Halloween text", () => {
    expect(() =>
      saleIsoDate("Halloween sale ends 31 Oct 2026, 23:59 UTC"),
    ).toThrow(/Halloween sale ends 31 Oct 2026/);
  });

  it("reports a date on DEMO_VALID_UNTIL as not later", () => {
    const text = "Winter sale ends 31 Jan 2027, 23:59 UTC";
    expect(saleIsoDate(text)).toBe("2027-01-31");
    expect(isLaterThan(text, DEMO_VALID_UNTIL)).toBe(false);
  });

  it("reports an earlier date as not later", () => {
    expect(
      isLaterThan("Winter sale ends 5 Dec 2026, 23:59 UTC", DEMO_VALID_UNTIL),
    ).toBe(false);
  });

  it("zero-pads a one-digit day", () => {
    expect(saleIsoDate("Winter sale ends 5 Mar 2027, 23:59 UTC")).toBe(
      "2027-03-05",
    );
  });
});
