import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MONTHS, TIME_ZONE_TOKENS } from "@/lib/detectors/data/months";
import { parseCalendarDates } from "@/lib/detectors/shared/calendar-date";
import { normaliseText, tokenise } from "@/lib/detectors/shared/text";

function parse(text: string) {
  return parseCalendarDates(tokenise(text));
}

const END_OF_FEB_2027 = Date.UTC(2027, 1, 28, 23, 59, 59);

describe("parseCalendarDates: day and month name", () => {
  it("parses '28 Feb 2027' as a full date ending at 23:59:59 UTC", () => {
    expect(parse("28 Feb 2027")).toEqual([
      { kind: "full", endMs: END_OF_FEB_2027, start: 0, end: 3 },
    ]);
  });

  it("parses English month-first '(February 28, 2027)'", () => {
    expect(parse("February 28, 2027")).toEqual([
      { kind: "full", endMs: END_OF_FEB_2027, start: 0, end: 4 },
    ]);
  });

  it("parses Turkish month names, with and without a year", () => {
    expect(parse("28 Şubat 2027")[0]).toMatchObject({
      kind: "full",
      endMs: END_OF_FEB_2027,
    });
    expect(parse("28 şubat")).toEqual([
      { kind: "no-year", endMs: null, start: 0, end: 2 },
    ]);
  });

  it("folds the dotless i of Turkish month names", () => {
    expect(parse("5 Mayıs 2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 4, 5, 23, 59, 59),
    });
    expect(parse("5 MAYIS 2027")[0].kind).toBe("full");
    expect(parse("3 Kasım 2027")[0].endMs).toBe(Date.UTC(2027, 10, 3, 23, 59, 59));
    expect(parse("3 Aralık 2027")[0].endMs).toBe(Date.UTC(2027, 11, 3, 23, 59, 59));
  });

  it("accepts ordinal suffixes", () => {
    expect(parse("1st March 2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 2, 1, 23, 59, 59),
    });
    expect(parse("March 3rd, 2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 2, 3, 23, 59, 59),
    });
  });

  it("parses a month-first date without a year", () => {
    expect(parse("February 28")).toEqual([
      { kind: "no-year", endMs: null, start: 0, end: 2 },
    ]);
  });

  it("accepts every three-letter English form and 'sept'", () => {
    for (const [index, name] of [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].entries()) {
      expect(parse(`10 ${name} 2027`)[0].endMs).toBe(
        Date.UTC(2027, index, 10, 23, 59, 59)
      );
    }
    expect(parse("10 Sept 2027")[0].endMs).toBe(Date.UTC(2027, 8, 10, 23, 59, 59));
  });
});

describe("parseCalendarDates: numeric forms", () => {
  it("parses ISO dates", () => {
    expect(parse("2027-02-28")).toEqual([
      { kind: "full", endMs: END_OF_FEB_2027, start: 0, end: 5 },
    ]);
  });

  it("parses dotted day-month-year dates", () => {
    expect(parse("28.02.2027")).toEqual([
      { kind: "full", endMs: END_OF_FEB_2027, start: 0, end: 1 },
    ]);
  });

  it("marks a slash date with two valid readings as ambiguous", () => {
    expect(parse("03/04/2027")).toEqual([
      { kind: "ambiguous", endMs: null, start: 0, end: 5 },
    ]);
  });

  it("reads a slash date with one valid reading", () => {
    expect(parse("13/04/2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 3, 13, 23, 59, 59),
    });
    expect(parse("04/13/2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 3, 13, 23, 59, 59),
    });
  });

  it("does not call a slash date ambiguous when both readings agree", () => {
    expect(parse("05/05/2027")[0]).toMatchObject({
      kind: "full",
      endMs: Date.UTC(2027, 4, 5, 23, 59, 59),
    });
  });

  it("ignores prices, versions and other dotted numbers", () => {
    expect(parse("$4.99")).toEqual([]);
    expect(parse("1.299,90")).toEqual([]);
    expect(parse("Size 42")).toEqual([]);
  });
});

describe("parseCalendarDates: validity", () => {
  it("rejects a day that does not exist in that month and year", () => {
    expect(parse("29 Feb 2027")).toEqual([]);
    expect(parse("31 Nisan 2027")).toEqual([]);
    expect(parse("32 Mart 2027")).toEqual([]);
    expect(parse("0 Mart 2027")).toEqual([]);
    expect(parse("2027-02-30")).toEqual([]);
    expect(parse("31.04.2027")).toEqual([]);
    expect(parse("30/02/2027")).toEqual([]);
  });

  it("uses the leap-year rule", () => {
    expect(parse("29 Feb 2028")[0].kind).toBe("full");
    expect(parse("29 Feb 2000")[0].kind).toBe("full");
    expect(parse("29 Feb 2029")).toEqual([]);
  });

  it("allows 29 February without a year but not 30 February or 31 April", () => {
    expect(parse("29 Feb")[0].kind).toBe("no-year");
    expect(parse("30 Feb")).toEqual([]);
    expect(parse("31 Nisan")).toEqual([]);
  });

  it("does not turn the day of an invalid date into another date", () => {
    expect(parse("31 Nisan 15")).toEqual([]);
  });

  it("does not accept a year outside 2000 to 2099", () => {
    expect(parse("28 Feb 1999")[0].kind).toBe("no-year");
    expect(parse("2127-02-28")).toEqual([]);
  });
});

describe("parseCalendarDates: stated time", () => {
  it("uses the stated time when there is one", () => {
    expect(parse("28 February 2027, 23:30")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 23, 30, 0)
    );
    expect(parse("2027-02-28 12:30:15")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 12, 30, 15)
    );
    expect(parse("28 Şubat 2027 saat 10:00")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 10, 0, 0)
    );
  });

  it("reads am and pm", () => {
    expect(parse("28 Feb 2027 at 8:30 pm")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 20, 30, 0)
    );
    expect(parse("28 Feb 2027 at 12:00 am")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 0, 0, 0)
    );
    expect(parse("28 Feb 2027 at 12:00 pm")[0].endMs).toBe(
      Date.UTC(2027, 1, 28, 12, 0, 0)
    );
  });

  it("falls back to 23:59:59 when the time is not valid", () => {
    expect(parse("28 Feb 2027, 25:00")[0].endMs).toBe(END_OF_FEB_2027);
    expect(parse("28 Feb 2027, 10:75")[0].endMs).toBe(END_OF_FEB_2027);
  });

  it("does not take the time as part of the date range", () => {
    expect(parse("28 Feb 2027, 23:59")[0]).toMatchObject({ start: 0, end: 3 });
  });

  it("gives no time to a date without a year", () => {
    expect(parse("28 Feb, 23:59")[0]).toMatchObject({ kind: "no-year", endMs: null });
  });
});

describe("parseCalendarDates: odd input", () => {
  it("finds several dates in order", () => {
    const result = parse("From 1 March 2027 until 15 March 2027");
    expect(result.map((d) => d.endMs)).toEqual([
      Date.UTC(2027, 2, 1, 23, 59, 59),
      Date.UTC(2027, 2, 15, 23, 59, 59),
    ]);
  });

  it("returns an empty list for no tokens or non-token input", () => {
    expect(parse("")).toEqual([]);
    expect(parseCalendarDates([])).toEqual([]);
    expect(parseCalendarDates(null as unknown as never[])).toEqual([]);
    expect(parseCalendarDates([null, 3] as unknown as never[])).toEqual([]);
  });

  it("returns a frozen list that does not change between calls", () => {
    const tokens = tokenise("Ends 28 Feb 2027 or 2027-03-01");
    const first = parseCalendarDates(tokens);
    expect(Object.isFrozen(first)).toBe(true);
    expect(parseCalendarDates(tokens)).toEqual(first);
  });
});

describe("months data", () => {
  it("lists twelve months in each language, each month number once per full name", () => {
    for (const language of ["en", "tr"] as const) {
      const months = new Set(MONTHS[language].map(([, number]) => number));
      expect([...months].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    }
  });

  it("holds the Turkish month names", () => {
    const names = MONTHS.tr.map(([name]) => normaliseText(name));
    expect(names).toEqual(
      [
        "ocak",
        "şubat",
        "mart",
        "nisan",
        "mayıs",
        "haziran",
        "temmuz",
        "ağustos",
        "eylül",
        "ekim",
        "kasım",
        "aralık",
      ].map((name) => normaliseText(name))
    );
  });

  it("freezes the data and lists time zone tokens in plain lower case", () => {
    expect(Object.isFrozen(MONTHS)).toBe(true);
    expect(Object.isFrozen(TIME_ZONE_TOKENS)).toBe(true);
    expect(TIME_ZONE_TOKENS).toEqual(
      expect.arrayContaining(["utc", "gmt", "cet", "cest", "est", "pst", "trt", "et", "pt"])
    );
    for (const token of TIME_ZONE_TOKENS) {
      expect(token).toBe(token.toLowerCase());
    }
  });
});

describe("calendar-date source", () => {
  it("does not use the built-in date text parser or read the clock", () => {
    const source = readFileSync("lib/detectors/shared/calendar-date.ts", "utf8");
    expect(source).not.toContain("Date.parse(");
    expect(source).not.toContain("Date.now(");
    expect(source).not.toContain("new Date(");
    expect(source).not.toContain("RegExp");
  });
});
