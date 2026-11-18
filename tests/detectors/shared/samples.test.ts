import { describe, it, expect } from "vitest";
import {
  buildSamplePair,
  findCounterpart,
  parseCapturedAt,
} from "@/lib/detectors/shared/samples";
import type { SamplePair } from "@/lib/detectors/shared/samples";
import type { IndexedElement } from "@/lib/detectors/shared/elements";
import { RELOAD_TEXT_CAP } from "@/lib/detectors/shared/constants";

type Raw = Record<string, unknown>;

const FIRST_TIME = "2026-12-01T12:00:00.000Z";
const RELOAD_TIME = "2026-12-01T12:00:09.000Z";

function raw(id: string, text: string, over: Raw = {}): Raw {
  return {
    id,
    tag: "span",
    text,
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontSize: "16px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    position: "static",
    checked: false,
    selected: false,
    ...over,
  };
}

function sample(capturedAt: unknown, elements: unknown, extra: Raw = {}): Raw {
  return {
    url: "https://shop.example/",
    capturedAt,
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    elements,
    ...extra,
  };
}

function snapshotWith(
  firstElements: unknown,
  reloadElements: unknown,
  times: { first?: unknown; reload?: unknown } = {}
): Raw {
  return sample("first" in times ? times.first : FIRST_TIME, firstElements, {
    afterReload: sample("reload" in times ? times.reload : RELOAD_TIME, reloadElements),
  });
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function pairOf(first: unknown[], reload: unknown[]): SamplePair {
  return buildSamplePair(snapshotWith(first, reload));
}

const always = (): boolean => true;
const never = (): boolean => false;

describe("parseCapturedAt", () => {
  it("accepts the strict UTC form and returns epoch milliseconds", () => {
    expect(parseCapturedAt("2026-12-01T12:00:00.000Z")).toBe(
      Date.UTC(2026, 11, 1, 12, 0, 0)
    );
    expect(parseCapturedAt("2026-12-01T12:00:00Z")).toBe(
      Date.UTC(2026, 11, 1, 12, 0, 0)
    );
    expect(parseCapturedAt("2026-12-01T12:00:00.5Z")).toBe(
      Date.UTC(2026, 11, 1, 12, 0, 0) + 500
    );
  });

  it.each([
    ["an offset time", "2026-12-01T12:00:00+02:00"],
    ["a date only", "2026-12-01"],
    ["a space instead of T", "2026-12-01 12:00:00Z"],
    ["an empty string", ""],
    ["a non-date", "not a date"],
    ["a lower-case z", "2026-12-01T12:00:00z"],
    ["a month of 13", "2026-13-01T12:00:00Z"],
    ["a day that rolls over", "2026-02-30T12:00:00Z"],
    ["an hour of 24", "2026-12-01T24:00:00Z"],
    ["a very long string", `2026-12-01T12:00:00Z${" ".repeat(10_000)}`],
  ])("rejects %s", (_name, value) => {
    expect(parseCapturedAt(value)).toBeNull();
  });

  it("rejects values that are not strings", () => {
    for (const value of [undefined, null, 0, 1.5e12, {}, [], true]) {
      expect(parseCapturedAt(value)).toBeNull();
    }
  });

  it("accepts a leap day and rejects a leap day in a common year", () => {
    expect(parseCapturedAt("2028-02-29T00:00:00Z")).not.toBeNull();
    expect(parseCapturedAt("2027-02-29T00:00:00Z")).toBeNull();
  });
});

describe("buildSamplePair and the gap", () => {
  it("gives a gap of 9 seconds from two valid times", () => {
    const pair = pairOf([raw("el-1", "a")], [raw("el-1", "a")]);
    expect(pair.gapSeconds).toBe(9);
    expect(pair.reload).not.toBeNull();
    expect(pair.first.elements.length).toBe(1);
  });

  it("keeps the limits of the gap: 3 and 120 seconds are usable", () => {
    const at = (seconds: number): string =>
      new Date(Date.UTC(2026, 11, 1, 12, 0, 0) + seconds * 1000).toISOString();
    const gapFor = (seconds: number) =>
      buildSamplePair(snapshotWith([], [], { reload: at(seconds) })).gapSeconds;
    expect(gapFor(3)).toBe(3);
    expect(gapFor(120)).toBe(120);
    expect(gapFor(2.9)).toBeNull();
    expect(gapFor(120.1)).toBeNull();
  });

  it("gives a null gap below 3 s, above 120 s, negative, zero or with an invalid time", () => {
    const gap = (first: unknown, reload: unknown) =>
      buildSamplePair(snapshotWith([], [], { first, reload })).gapSeconds;
    expect(gap(FIRST_TIME, "2026-12-01T12:00:02.000Z")).toBeNull();
    expect(gap(FIRST_TIME, "2026-12-01T12:03:20.000Z")).toBeNull();
    expect(gap(FIRST_TIME, "2026-12-01T11:59:50.000Z")).toBeNull();
    expect(gap(FIRST_TIME, FIRST_TIME)).toBeNull();
    expect(gap("2026-12-01", RELOAD_TIME)).toBeNull();
    expect(gap(FIRST_TIME, "2026-12-01T12:00:09+00:00")).toBeNull();
    expect(gap(undefined, RELOAD_TIME)).toBeNull();
    expect(gap(FIRST_TIME, 12345)).toBeNull();
  });

  it("keeps the reload index even when the gap is unusable", () => {
    const pair = buildSamplePair(
      snapshotWith([raw("el-1", "a")], [raw("el-1", "a")], { reload: "junk" })
    );
    expect(pair.gapSeconds).toBeNull();
    expect(pair.reload).not.toBeNull();
  });

  it("gives reload null and no gap without afterReload", () => {
    const pair = buildSamplePair(sample(FIRST_TIME, [raw("el-1", "a")]));
    expect(pair.reload).toBeNull();
    expect(pair.gapSeconds).toBeNull();
    expect(pair.first.elements.length).toBe(1);
  });

  it("treats an afterReload that is not a sample as missing", () => {
    for (const bad of [null, 5, "x", {}, { elements: "no" }]) {
      const pair = buildSamplePair(
        sample(FIRST_TIME, [raw("el-1", "a")], { afterReload: bad })
      );
      expect(pair.reload).toBeNull();
      expect(pair.gapSeconds).toBeNull();
    }
  });

  it("builds the reload index with the light rules (reload text cap)", () => {
    const pair = pairOf([raw("el-1", "a".repeat(300))], [raw("el-1", "a".repeat(300))]);
    expect(must(pair.first.byId("el-1")).text.length).toBe(300);
    expect(must(must(pair.reload).byId("el-1")).text.length).toBe(RELOAD_TEXT_CAP);
  });

  it("never reads secondSample", () => {
    const hostile = snapshotWith([raw("el-1", "a")], [raw("el-1", "a")]);
    Object.defineProperty(hostile, "secondSample", {
      enumerable: true,
      get() {
        throw new Error("secondSample was read");
      },
    });
    expect(() => buildSamplePair(hostile)).not.toThrow();
    expect(buildSamplePair(hostile).gapSeconds).toBe(9);
  });

  it("does not throw on values that are not snapshots", () => {
    for (const bad of [null, undefined, 4, "x", [], {}, { elements: 3 }]) {
      const pair = buildSamplePair(bad);
      expect(pair.first.elements).toEqual([]);
      expect(pair.reload).toBeNull();
      expect(pair.gapSeconds).toBeNull();
    }
  });
});

describe("findCounterpart", () => {
  it("takes the element with the same id when its text matches the template", () => {
    const pair = pairOf(
      [raw("el-1-0", "Only 2 left"), raw("el-1-1", "Only 2 left")],
      [raw("el-1-0", "Only 6 left"), raw("el-1-1", "Selling fast")]
    );
    const first = must(pair.first.byId("el-1-0"));
    const found = findCounterpart(pair, first, (c) => c.text.includes("left"));
    expect(must(found).id).toBe("el-1-0");
    expect(must(found).text).toBe("Only 6 left");
  });

  it("falls back to the same shape in the same parent when the id element does not match", () => {
    const pair = pairOf(
      [raw("el-1-0", "Only 2 left")],
      [
        raw("el-1-0", "Totally different"),
        raw("el-1-3", "Only 9 left"),
        raw("el-2-0", "Only 4 left"),
      ]
    );
    const first = must(pair.first.byId("el-1-0"));
    const found = findCounterpart(pair, first, (c) => c.text.startsWith("Only 2"));
    expect(must(found).id).toBe("el-1-3");
  });

  it("uses the same shape in the same parent when the id is missing in the reload sample", () => {
    const pair = pairOf(
      [raw("el-1-0", "4 people are viewing this")],
      [raw("el-1-5", "11 people are viewing this"), raw("el-3-1", "12 people are viewing this")]
    );
    const first = must(pair.first.byId("el-1-0"));
    expect(must(findCounterpart(pair, first, never)).id).toBe("el-1-5");
  });

  it("takes the only element of the sample with that shape when no sibling has it", () => {
    const pair = pairOf(
      [raw("el-1-0-0", "Only 2 left"), raw("el-1-1", "Other")],
      [raw("el-2-5", "Only 7 left"), raw("el-2-6", "Something else")]
    );
    const first = must(pair.first.byId("el-1-0-0"));
    expect(must(findCounterpart(pair, first, never)).id).toBe("el-2-5");
  });

  it("gives null when that shape is not unique in the sample", () => {
    const pair = pairOf(
      [raw("el-1-0-0", "Only 2 left")],
      [raw("el-2-5", "Only 7 left"), raw("el-3-5", "Only 8 left")]
    );
    const first = must(pair.first.byId("el-1-0-0"));
    expect(findCounterpart(pair, first, never)).toBeNull();
  });

  it("gives null when nothing in the reload sample has the shape", () => {
    const pair = pairOf([raw("el-1", "Only 2 left")], [raw("el-9", "Hello")]);
    expect(findCounterpart(pair, must(pair.first.byId("el-1")), never)).toBeNull();
  });

  it("gives null without a reload sample", () => {
    const pair = buildSamplePair(sample(FIRST_TIME, [raw("el-1", "Only 2 left")]));
    expect(findCounterpart(pair, must(pair.first.byId("el-1")), always)).toBeNull();
  });

  it("never pairs an element with empty text by shape", () => {
    const pair = pairOf([raw("el-1-0", "")], [raw("el-1-1", ""), raw("el-5", "")]);
    expect(findCounterpart(pair, must(pair.first.byId("el-1-0")), never)).toBeNull();
  });

  it("skips hidden reload elements", () => {
    const pair = pairOf(
      [raw("el-1-0", "Only 2 left")],
      [
        raw("el-1-0", "Only 6 left", { display: "none" }),
        raw("el-1-1", "Only 7 left", { visibility: "hidden" }),
        raw("el-4", "Only 8 left"),
      ]
    );
    const first = must(pair.first.byId("el-1-0"));
    // The only visible element with the shape is el-4, and it is unique among the visible ones.
    expect(must(findCounterpart(pair, first, always)).id).toBe("el-4");
  });

  it("compares only the first 120 characters of a longer first text", () => {
    const longFirst = "Only 2 left in stock. ".repeat(14).slice(0, 300);
    const cutReload = longFirst.slice(0, RELOAD_TEXT_CAP).replace("2", "7");
    const pair = pairOf(
      [raw("el-1-0", longFirst)],
      [raw("el-1-3", cutReload), raw("el-2", "Unrelated")]
    );
    const first = must(pair.first.byId("el-1-0"));
    expect(first.text.length).toBe(300);
    expect(must(findCounterpart(pair, first, never)).id).toBe("el-1-3");
  });

  it("compares text and state only, never positions or sizes", () => {
    const moved = { x: 400, y: 900, width: 33, height: 77 };
    const pair = pairOf(
      [raw("el-1-0", "Only 2 left")],
      [raw("el-1-4", "Only 6 left", { boundingBox: moved })]
    );
    const first = must(pair.first.byId("el-1-0"));
    expect(must(findCounterpart(pair, first, never)).id).toBe("el-1-4");
  });

  it("does not read secondSample", () => {
    const snapshot = snapshotWith([raw("el-1", "Only 2 left")], [raw("el-1", "Only 6 left")]);
    Object.defineProperty(snapshot, "secondSample", {
      enumerable: true,
      get() {
        throw new Error("secondSample was read");
      },
    });
    const pair = buildSamplePair(snapshot);
    const first = must(pair.first.byId("el-1"));
    expect(must(findCounterpart(pair, first, always)).text).toBe("Only 6 left");
  });

  it("passes only reload elements to the template check", () => {
    const pair = pairOf([raw("el-1", "Only 2 left")], [raw("el-1", "Only 6 left")]);
    const reload = must(pair.reload);
    const seen: IndexedElement[] = [];
    findCounterpart(pair, must(pair.first.byId("el-1")), (candidate) => {
      seen.push(candidate);
      return true;
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const candidate of seen) expect(reload.elements).toContain(candidate);
  });
});
