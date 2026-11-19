import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseCountdowns } from "@/lib/detectors/shared/countdown";
import { tokenise } from "@/lib/detectors/shared/text";

function parse(text: string) {
  return parseCountdowns(tokenise(text));
}

describe("parseCountdowns: clock forms", () => {
  it("parses HH:MM:SS as seconds with a display unit of 1 s", () => {
    const [countdown, ...rest] = parse("04:59:59");
    expect(rest).toEqual([]);
    expect(countdown).toEqual({
      seconds: 17999,
      unitSeconds: 1,
      form: "clock3",
      start: 0,
      end: 1,
    });
  });

  it("reports the token range of a countdown inside a sentence", () => {
    const result = parse("Sale ends in 04:59:59");
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(3);
    expect(result[0].end).toBe(4);
  });

  it("parses H:MM:SS", () => {
    const [countdown] = parse("4:05:09");
    expect(countdown.seconds).toBe(4 * 3600 + 5 * 60 + 9);
    expect(countdown.form).toBe("clock3");
  });

  it("parses MM:SS with and without a leading zero", () => {
    expect(parse("9:59")[0]).toMatchObject({
      seconds: 599,
      unitSeconds: 1,
      form: "clock2",
    });
    expect(parse("09:59")[0]).toMatchObject({ seconds: 599, form: "clock2" });
  });

  it("rejects minutes over 59 in the three-part form", () => {
    expect(parse("04:61:00")).toEqual([]);
  });

  it("rejects seconds over 59 in either clock form", () => {
    expect(parse("04:59:61")).toEqual([]);
    expect(parse("09:75")).toEqual([]);
  });

  it("accepts a first field over 59 in the two-part form", () => {
    expect(parse("75:00")[0]).toMatchObject({ seconds: 4500, form: "clock2" });
  });

  it("rejects one-part, four-part and non-digit clock tokens", () => {
    expect(parse("12")).toEqual([]);
    expect(parse("12:30:45:10")).toEqual([]);
    expect(parse("1.5:30")).toEqual([]);
  });

  it("finds two countdowns in one text, in order", () => {
    const result = parse("Ends in 02:00:00 or in 3 days");
    expect(result.map((c) => c.seconds)).toEqual([7200, 259200]);
    expect(result[0].start).toBeLessThan(result[1].start);
  });
});

describe("parseCountdowns: number and unit forms", () => {
  it("parses hours and minutes with a minute display unit", () => {
    expect(parse("2h 30m")[0]).toEqual({
      seconds: 9000,
      unitSeconds: 60,
      form: "units",
      start: 0,
      end: 4,
    });
  });

  it("parses English long unit words", () => {
    expect(parse("1 day 3 hours")[0]).toMatchObject({
      seconds: 86400 + 3 * 3600,
      unitSeconds: 3600,
      form: "units",
    });
    expect(parse("5 mins 10 secs")[0]).toMatchObject({
      seconds: 310,
      unitSeconds: 1,
    });
  });

  it("uses a day display unit for days only", () => {
    expect(parse("3 days")[0]).toMatchObject({
      seconds: 259200,
      unitSeconds: 86400,
      form: "units",
    });
  });

  it("parses Turkish unit words", () => {
    expect(parse("2 gün 4 saat")[0]).toMatchObject({
      seconds: 2 * 86400 + 4 * 3600,
      unitSeconds: 3600,
    });
    expect(parse("15 dk 30 sn")[0]).toMatchObject({
      seconds: 930,
      unitSeconds: 1,
    });
    expect(parse("10 dakika")[0]).toMatchObject({ seconds: 600, unitSeconds: 60 });
    expect(parse("45 saniye")[0]).toMatchObject({ seconds: 45, unitSeconds: 1 });
  });

  it("takes up to four pairs", () => {
    const [countdown] = parse("1d 2h 3m 4s");
    expect(countdown.seconds).toBe(86400 + 7200 + 180 + 4);
    expect(countdown.unitSeconds).toBe(1);
    expect(countdown.end).toBe(8);
  });

  it("allows a comma or 'and' between pairs", () => {
    expect(parse("2 days, 4 hours")[0].seconds).toBe(2 * 86400 + 4 * 3600);
    expect(parse("2 hours and 5 minutes")[0].seconds).toBe(7500);
  });

  // Requirement 7.1: "30m 2h" is two one-pair reads with a one-letter unit
  // each, so it no longer parses; the same rule is tested with unit words.
  it("starts a new countdown when the units do not descend", () => {
    expect(parse("30 min 2 hours").map((c) => c.seconds)).toEqual([1800, 7200]);
    expect(parse("30m 2h")).toEqual([]);
  });

  describe("one-letter units (requirements 7.1, 7.2)", () => {
    it("does not parse one pair with a one-letter unit", () => {
      expect(parse("5 m")).toEqual([]);
      expect(parse("1 M")).toEqual([]);
      expect(parse("30 s")).toEqual([]);
      expect(parse("3 d")).toEqual([]);
      expect(parse("12 h")).toEqual([]);
      expect(parse("Only 5 m left")).toEqual([]);
    });

    it("does not parse a pair whose one-letter unit is upper case", () => {
      expect(parse("2H 30M")).toEqual([]);
      expect(parse("2h 30M")).toEqual([]);
      expect(parse("2H 30m")).toEqual([]);
    });

    it("parses two or more lower-case pairs", () => {
      expect(parse("2h 30m")).toHaveLength(1);
      expect(parse("2h 30m")[0].seconds).toBe(9000);
      expect(parse("1d 2h 3m 4s")).toHaveLength(1);
    });

    it("keeps a word-unit pair that precedes an upper-case one-letter unit", () => {
      expect(parse("1 day 3 H")[0]).toMatchObject({ seconds: 86400, end: 2 });
    });

    it("parses unit words of more than one letter, also on their own", () => {
      expect(parse("30 sec")[0].seconds).toBe(30);
      expect(parse("2 days")[0].seconds).toBe(172800);
      expect(parse("15 min")[0].seconds).toBe(900);
      expect(parse("2 gün")[0].seconds).toBe(172800);
      expect(parse("3 saat")[0].seconds).toBe(10800);
      expect(parse("15 dk")[0].seconds).toBe(900);
      expect(parse("30 sn")[0].seconds).toBe(30);
    });
  });

  it("ignores numbers without a unit and units without a number", () => {
    expect(parse("Size 42")).toEqual([]);
    expect(parse("hours of fun")).toEqual([]);
    expect(parse("2 apples")).toEqual([]);
  });

  it("ignores a fractional number before a unit", () => {
    expect(parse("1.5 hours")).toEqual([]);
  });
});

describe("parseCountdowns: times of day are not countdowns", () => {
  it("skips a time followed by a time zone", () => {
    expect(parse("Ends 23:59 UTC")).toEqual([]);
    expect(parse("Ends 23:59 trt")).toEqual([]);
  });

  it("skips a time after 'at' or 'saat'", () => {
    expect(parse("Ends at 23:59")).toEqual([]);
    expect(parse("saat 23:59")).toEqual([]);
  });

  it("skips a time followed by am or pm", () => {
    expect(parse("Ends 8:30 pm")).toEqual([]);
    expect(parse("8:30 AM")).toEqual([]);
  });

  it("skips a time that follows a calendar date", () => {
    expect(parse("28 Feb 2027, 23:59")).toEqual([]);
    expect(parse("2027-02-28 23:59:59")).toEqual([]);
  });

  it("still parses a clock that merely sits near other words", () => {
    expect(parse("Ends in 23:59:59")).toHaveLength(1);
    expect(parse("Offer ends in 09:59 hurry")).toHaveLength(1);
  });
});

describe("parseCountdowns: odd input", () => {
  it("returns an empty list for no tokens or non-token input", () => {
    expect(parse("")).toEqual([]);
    expect(parseCountdowns([])).toEqual([]);
    expect(parseCountdowns(null as unknown as never[])).toEqual([]);
    expect(parseCountdowns("04:59:59" as unknown as never[])).toEqual([]);
    expect(parseCountdowns([null, undefined, 5] as unknown as never[])).toEqual([]);
  });

  it("returns a frozen list that does not change between calls", () => {
    const tokens = tokenise("Ends in 04:59:59 or 2h 30m");
    const first = parseCountdowns(tokens);
    expect(Object.isFrozen(first)).toBe(true);
    expect(parseCountdowns(tokens)).toEqual(first);
  });

  it("stays bounded on a long run of repeated near-matches", () => {
    const text = "2 2 2 2 2 2 h 2 h 2 m ".repeat(500);
    const started = Date.now();
    const result = parse(text);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

describe("countdown source", () => {
  it("reads no clock and builds no regular expression", () => {
    const source = readFileSync("lib/detectors/shared/countdown.ts", "utf8");
    expect(source).not.toContain("Date.parse(");
    expect(source).not.toContain("Date.now(");
    expect(source).not.toContain("RegExp");
  });
});
