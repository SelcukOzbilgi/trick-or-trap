import { describe, it, expect } from "vitest";
import { SAFE_PATTERNS } from "@/lib/detectors/shared/patterns";

const MAX_BOUND = 300;

/**
 * Reads a pattern source and lists the ways it breaks the safety rules of
 * requirement 15.7: no `+`, no `*`, no `{n,}`, no quantifier other than `?`
 * after a closing parenthesis, no quantified group whose body has a
 * quantifier, and every `{m,n}` bound at most 300.
 */
function violations(source: string): string[] {
  const found: string[] = [];
  // One entry per open group: does its body hold a quantifier?
  const stack: boolean[] = [];
  let inClass = false;
  let prev = "";
  let closedGroupHadQuantifier = false;

  const markQuantifier = (): void => {
    if (stack.length > 0) stack[stack.length - 1] = true;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      prev = "\\";
      continue;
    }
    if (inClass) {
      if (ch === "]") {
        inClass = false;
        prev = "]";
      }
      continue;
    }
    if (ch === "[") {
      inClass = true;
      prev = "[";
      continue;
    }
    if (ch === "(") {
      stack.push(false);
      // "(?:", "(?=" and similar: skip the "?" and the kind character.
      if (source[i + 1] === "?") i += 2;
      prev = "(";
      continue;
    }
    if (ch === ")") {
      closedGroupHadQuantifier = stack.pop() ?? false;
      // A quantifier inside the group is also inside the enclosing group.
      if (closedGroupHadQuantifier) markQuantifier();
      prev = ")";
      continue;
    }

    let isQuantifier = false;
    if (ch === "+" || ch === "*") {
      found.push(`unbounded quantifier ${ch}`);
      isQuantifier = true;
    } else if (ch === "?") {
      isQuantifier = true;
    } else if (ch === "{") {
      const close = source.indexOf("}", i);
      const body = close === -1 ? "" : source.slice(i + 1, close);
      const range = /^(\d+)(,(\d*))?$/.exec(body);
      if (range) {
        isQuantifier = true;
        if (range[2] !== undefined && range[3] === "") {
          found.push(`open range {${body}}`);
        }
        for (const bound of [range[1], range[3]]) {
          if (bound !== undefined && bound !== "" && Number(bound) > MAX_BOUND) {
            found.push(`bound ${bound} above ${MAX_BOUND}`);
          }
        }
        i = close;
      }
    }

    if (isQuantifier && prev === ")") {
      if (ch !== "?") {
        found.push("quantifier other than ? after )");
      }
      if (closedGroupHadQuantifier) {
        found.push("quantified group whose body has a quantifier");
      }
    }
    if (isQuantifier) markQuantifier();
    prev = ch === "{" ? "}" : ch;
  }
  return found;
}

describe("the safety checker itself", () => {
  it.each([
    ["a+", "unbounded quantifier +"],
    ["a*", "unbounded quantifier *"],
    ["a{2,}", "open range {2,}"],
    ["(a)+", "quantifier other than ? after )"],
    ["(a)*", "quantifier other than ? after )"],
    ["(ab){2}", "quantifier other than ? after )"],
    ["(a{2})?", "quantified group whose body has a quantifier"],
    ["((a)?b)?", "quantified group whose body has a quantifier"],
    ["a{301}", "bound 301 above 300"],
    ["a{1,301}", "bound 301 above 300"],
  ])("flags %s", (source, expected) => {
    expect(violations(source)).toContain(expected);
  });

  it.each([
    "a?",
    "(ab)?",
    "(a|b)?",
    "(?:ab)?",
    "a{300}",
    "a{1,300}",
    "[+*]",
    "\\+\\*",
    "^(a|b{2})$",
  ])("accepts %s", (source) => {
    expect(violations(source)).toEqual([]);
  });
});

describe("SAFE_PATTERNS", () => {
  it("holds at least the three patterns the helpers need", () => {
    expect(Object.keys(SAFE_PATTERNS).sort()).toEqual(["digits", "isoUtc", "px"]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SAFE_PATTERNS)).toBe(true);
  });

  for (const [name, pattern] of Object.entries(SAFE_PATTERNS)) {
    describe(name, () => {
      it("breaks none of the safety rules", () => {
        expect(violations(pattern.source)).toEqual([]);
      });

      it("has no global or sticky flag, so it keeps no state between calls", () => {
        expect(pattern.global).toBe(false);
        expect(pattern.sticky).toBe(false);
      });

      it("is anchored at both ends", () => {
        expect(pattern.source.startsWith("^")).toBe(true);
        expect(pattern.source.endsWith("$")).toBe(true);
      });
    });
  }

  describe("isoUtc", () => {
    const { isoUtc } = SAFE_PATTERNS;

    it("accepts a UTC time with and without a fraction", () => {
      expect(isoUtc.test("2026-12-01T12:00:00.000Z")).toBe(true);
      expect(isoUtc.test("2026-12-01T12:00:00Z")).toBe(true);
      expect(isoUtc.test("2026-12-01T12:00:00.5Z")).toBe(true);
      expect(isoUtc.test("2026-12-01T12:00:00.123456789Z")).toBe(true);
    });

    it("rejects offsets, dates alone and other shapes", () => {
      expect(isoUtc.test("2026-12-01T12:00:00+02:00")).toBe(false);
      expect(isoUtc.test("2026-12-01")).toBe(false);
      expect(isoUtc.test("")).toBe(false);
      expect(isoUtc.test("2026-12-01T12:00:00.Z")).toBe(false);
      expect(isoUtc.test("2026-12-01T12:00:00.1234567890Z")).toBe(false);
      expect(isoUtc.test("2026-12-01 12:00:00Z")).toBe(false);
      expect(isoUtc.test("2026-12-01T12:00:00.000Z\n")).toBe(false);
      expect(isoUtc.test(" 2026-12-01T12:00:00.000Z")).toBe(false);
    });
  });

  describe("px", () => {
    const { px } = SAFE_PATTERNS;

    it("accepts whole and fractional pixel values", () => {
      expect(px.test("20px")).toBe(true);
      expect(px.test("11.5px")).toBe(true);
      expect(px.test("0px")).toBe(true);
    });

    it("rejects other units and malformed values", () => {
      expect(px.test("1.5em")).toBe(false);
      expect(px.test("px")).toBe(false);
      expect(px.test("12.px")).toBe(false);
      expect(px.test("-4px")).toBe(false);
      expect(px.test("12 px")).toBe(false);
      expect(px.test("1234567px")).toBe(false);
    });
  });

  describe("digits", () => {
    const { digits } = SAFE_PATTERNS;

    it("accepts a run of digits only", () => {
      expect(digits.test("0")).toBe(true);
      expect(digits.test("2027")).toBe(true);
    });

    it("rejects empty, mixed and over-long input", () => {
      expect(digits.test("")).toBe(false);
      expect(digits.test("12a")).toBe(false);
      expect(digits.test("1.5")).toBe(false);
      expect(digits.test("1".repeat(301))).toBe(false);
    });
  });

  it("answers in bounded time on a 1,000,000-character near-match", () => {
    const hostile = `2026-12-01T12:00:00.${"1".repeat(1_000_000)}`;
    const start = performance.now();
    for (const pattern of Object.values(SAFE_PATTERNS)) {
      pattern.test(hostile);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });
});
