import { describe, expect, it } from "vitest";
import {
  base64Length,
  chooseMode,
  isOutsideImages,
  planSingle,
  reachesBottom,
  tileCount,
  tileTarget,
  toDocumentBox,
  totalFits,
} from "@/lib/capture/geometry";

describe("toDocumentBox", () => {
  it("adds the scroll offsets to the viewport-relative rectangle", () => {
    expect(toDocumentBox({ left: 10, top: 20, width: 5, height: 6 }, { x: 3, y: 100 })).toEqual({
      x: 13,
      y: 120,
      width: 5,
      height: 6,
    });
  });

  it("replaces non-finite numbers with 0", () => {
    const box = toDocumentBox(
      { left: Number.NaN, top: Number.POSITIVE_INFINITY, width: Number.NEGATIVE_INFINITY, height: Number.NaN },
      { x: Number.NaN, y: 7 }
    );
    expect(box).toEqual({ x: 0, y: 7, width: 0, height: 0 });
  });

  it("replaces negative sizes with 0 but keeps negative positions", () => {
    expect(toDocumentBox({ left: -4, top: -5, width: -3, height: -1 }, { x: 0, y: 0 })).toEqual({
      x: -4,
      y: -5,
      width: 0,
      height: 0,
    });
  });

  it("rounds to two decimals", () => {
    expect(toDocumentBox({ left: 1.234, top: 2.3456, width: 3.14159, height: 0.004 }, { x: 0.1, y: 0.2 })).toEqual({
      x: 1.33,
      y: 2.55,
      width: 3.14,
      height: 0,
    });
  });
});

describe("chooseMode", () => {
  it("uses single mode up to 30,000 device px at DPR 1", () => {
    expect(chooseMode({ fullHeight: 29_999, devicePixelRatio: 1 })).toBe("single");
    expect(chooseMode({ fullHeight: 30_000, devicePixelRatio: 1 })).toBe("single");
  });

  it("uses tiled mode above 30,000 device px at DPR 1", () => {
    expect(chooseMode({ fullHeight: 30_001, devicePixelRatio: 1 })).toBe("tiled");
  });

  it("multiplies by the device pixel ratio", () => {
    expect(chooseMode({ fullHeight: 15_000, devicePixelRatio: 2 })).toBe("single");
    expect(chooseMode({ fullHeight: 15_001, devicePixelRatio: 2 })).toBe("tiled");
  });
});

describe("planSingle", () => {
  it("captures the full height of a short page", () => {
    const plan = planSingle({ fullHeight: 5_000, viewportWidth: 1280 });
    expect(plan).toEqual({ offsetY: 0, width: 1280, height: 5_000, truncated: false });
  });

  it("does not truncate at exactly 8,000", () => {
    expect(planSingle({ fullHeight: 8_000, viewportWidth: 1280 })).toMatchObject({ height: 8_000, truncated: false });
  });

  it("truncates at 8,001 and above", () => {
    expect(planSingle({ fullHeight: 8_001, viewportWidth: 1280 })).toMatchObject({ height: 8_000, truncated: true });
    expect(planSingle({ fullHeight: 45_000, viewportWidth: 1280 })).toMatchObject({ height: 8_000, truncated: true });
  });

  it("rounds the width and a fractional height up", () => {
    const plan = planSingle({ fullHeight: 1_234.2, viewportWidth: 1279.5 });
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(1_235);
    expect(plan.offsetY).toBe(0);
  });

  it("keeps width and height at least 1", () => {
    expect(planSingle({ fullHeight: 0, viewportWidth: 0 })).toMatchObject({ width: 1, height: 1 });
    expect(planSingle({ fullHeight: Number.NaN, viewportWidth: -5 })).toMatchObject({ width: 1, height: 1 });
  });
});

describe("tile planning", () => {
  it("targets index times viewport height", () => {
    expect(tileTarget(0, 800)).toBe(0);
    expect(tileTarget(3, 800)).toBe(2_400);
  });

  it("counts the tiles needed for a short tall page", () => {
    expect(tileCount(3_000, 800)).toBe(4);
  });

  it("caps the count at 10", () => {
    expect(tileCount(45_000, 800)).toBe(10);
    expect(tileCount(8_000, 800)).toBe(10);
    expect(tileCount(8_001, 800)).toBe(10);
  });

  it("returns at least one tile", () => {
    expect(tileCount(0, 800)).toBe(1);
    expect(tileCount(3_000, 0)).toBe(1);
  });

  it("reaches the bottom within one pixel", () => {
    expect(reachesBottom({ offsetY: 1_600, height: 800 }, 2_400)).toBe(true);
    expect(reachesBottom({ offsetY: 1_600, height: 800 }, 2_400.5)).toBe(true);
    expect(reachesBottom({ offsetY: 1_600, height: 800 }, 2_402)).toBe(false);
  });

  it("lets a clamped last tile overlap the previous one and reach the bottom", () => {
    const previous = { offsetY: 1_600, height: 800 };
    const last = { offsetY: 2_200, height: 800 };
    expect(reachesBottom(previous, 3_000)).toBe(false);
    expect(last.offsetY).toBeLessThan(previous.offsetY + previous.height);
    expect(reachesBottom(last, 3_000)).toBe(true);
  });
});

describe("isOutsideImages", () => {
  const one = [{ offsetY: 0, width: 1280, height: 5_000 }];

  it("is false for a box inside the image", () => {
    expect(isOutsideImages({ x: 10, y: 10, width: 50, height: 20 }, one)).toBe(false);
  });

  it("is true when the box starts at the image height", () => {
    expect(isOutsideImages({ x: 10, y: 5_000, width: 50, height: 20 }, one)).toBe(true);
  });

  it("is true when the box starts at the image width", () => {
    expect(isOutsideImages({ x: 1_280, y: 10, width: 50, height: 20 }, one)).toBe(true);
  });

  it("is false for a box that starts inside and extends beyond the image", () => {
    expect(isOutsideImages({ x: 1_270, y: 4_990, width: 100, height: 100 }, one)).toBe(false);
  });

  const tiles = [
    { offsetY: 0, width: 1280, height: 800 },
    { offsetY: 800, width: 1280, height: 800 },
    { offsetY: 1_600, width: 1280, height: 800 },
  ];

  it("is false for a box inside the second tile", () => {
    expect(isOutsideImages({ x: 0, y: 900, width: 100, height: 40 }, tiles)).toBe(false);
  });

  it("is true for a box below the last tile", () => {
    expect(isOutsideImages({ x: 0, y: 2_400, width: 100, height: 40 }, tiles)).toBe(true);
    expect(isOutsideImages({ x: 0, y: 5_000, width: 100, height: 40 }, tiles)).toBe(true);
  });

  it("is false for a box that spans a gap between tiles", () => {
    const gap = [
      { offsetY: 0, width: 1280, height: 800 },
      { offsetY: 1_600, width: 1280, height: 800 },
    ];
    expect(isOutsideImages({ x: 0, y: 700, width: 100, height: 1_000 }, gap)).toBe(false);
  });

  it("is true when there are no images", () => {
    expect(isOutsideImages({ x: 0, y: 0, width: 10, height: 10 }, [])).toBe(true);
  });
});

describe("base64 sizes", () => {
  it("computes 4 * ceil(n / 3)", () => {
    expect(base64Length(0)).toBe(0);
    expect(base64Length(1)).toBe(4);
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
  });

  it("accepts one image of 3,145,728 bytes and rejects one more byte", () => {
    expect(totalFits([3_145_728])).toBe(true);
    expect(totalFits([3_145_729])).toBe(false);
  });

  it("sums the base64 lengths over all images", () => {
    expect(totalFits([1_572_864, 1_572_864])).toBe(true);
    expect(totalFits([1_572_864, 1_572_865])).toBe(false);
  });

  it("accepts an empty list", () => {
    expect(totalFits([])).toBe(true);
  });
});
