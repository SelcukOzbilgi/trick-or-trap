import { describe, expect, it } from "vitest";
import { BROWSER_VIEWPORT, MAX_PLAUSIBLE_PX } from "@/lib/capture/constants";
import {
  base64Length,
  chooseMode,
  isOutsideImages,
  maxBoxDrift,
  planSingle,
  reachesBottom,
  sanitiseMetrics,
  tileCount,
  tileTarget,
  toDocumentBox,
  totalFits,
} from "@/lib/capture/geometry";
import type { ElementSnapshot } from "@/lib/types";

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

describe("sanitiseMetrics", () => {
  const good = {
    innerWidth: 1200,
    innerHeight: 700,
    scrollX: 5,
    scrollY: 40,
    scrollWidth: 1300,
    scrollHeight: 9_000,
    layoutWidth: 1185,
    devicePixelRatio: 2,
  };

  it("keeps plausible values unchanged", () => {
    expect(sanitiseMetrics(good)).toEqual(good);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5, MAX_PLAUSIBLE_PX + 1, "12", null, undefined])(
    "replaces %s in a viewport size and the layout width with the viewport value",
    (bad) => {
      const out = sanitiseMetrics({ ...good, innerWidth: bad, innerHeight: bad, layoutWidth: bad });
      expect(out.innerWidth).toBe(BROWSER_VIEWPORT.width);
      expect(out.innerHeight).toBe(BROWSER_VIEWPORT.height);
      // An absent layoutWidth means innerWidth, which is itself replaced by the viewport width.
      expect(out.layoutWidth).toBe(BROWSER_VIEWPORT.width);
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -5, "9000", null])(
    "replaces %s in a document size with the viewport value",
    (bad) => {
      const out = sanitiseMetrics({ ...good, scrollWidth: bad, scrollHeight: bad });
      expect(out.scrollWidth).toBe(BROWSER_VIEWPORT.width);
      expect(out.scrollHeight).toBe(BROWSER_VIEWPORT.height);
    }
  );

  it("clamps a document size above the limit instead of making the page look small", () => {
    const out = sanitiseMetrics({ ...good, scrollHeight: 1e9, scrollWidth: MAX_PLAUSIBLE_PX + 1 });
    expect(out.scrollHeight).toBe(MAX_PLAUSIBLE_PX);
    expect(out.scrollWidth).toBe(MAX_PLAUSIBLE_PX);
  });

  it("accepts a size at the limit", () => {
    expect(sanitiseMetrics({ ...good, innerWidth: MAX_PLAUSIBLE_PX }).innerWidth).toBe(MAX_PLAUSIBLE_PX);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, "3", null])("replaces %s in a scroll offset with 0", (bad) => {
    const out = sanitiseMetrics({ ...good, scrollX: bad, scrollY: bad });
    expect(out.scrollX).toBe(0);
    expect(out.scrollY).toBe(0);
  });

  it("keeps a scroll offset of 0", () => {
    const out = sanitiseMetrics({ ...good, scrollX: 0, scrollY: 0 });
    expect(out.scrollX).toBe(0);
    expect(out.scrollY).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 8.01, 1e9, "2", null, undefined])(
    "gives ratio 1 for a device pixel ratio of %s",
    (bad) => {
      expect(sanitiseMetrics({ ...good, devicePixelRatio: bad }).devicePixelRatio).toBe(1);
    }
  );

  it("accepts ratios in (0, 8]", () => {
    expect(sanitiseMetrics({ ...good, devicePixelRatio: 0.5 }).devicePixelRatio).toBe(0.5);
    expect(sanitiseMetrics({ ...good, devicePixelRatio: 8 }).devicePixelRatio).toBe(8);
  });

  it("uses innerWidth when layoutWidth is absent", () => {
    expect(sanitiseMetrics({ ...good, layoutWidth: undefined }).layoutWidth).toBe(1200);
  });

  it("returns viewport values for an empty or non-object input", () => {
    for (const input of [{}, null, undefined, "x", 5]) {
      const out = sanitiseMetrics(input as unknown as Record<string, unknown>);
      expect(out).toEqual({
        innerWidth: BROWSER_VIEWPORT.width,
        innerHeight: BROWSER_VIEWPORT.height,
        scrollX: 0,
        scrollY: 0,
        scrollWidth: BROWSER_VIEWPORT.width,
        scrollHeight: BROWSER_VIEWPORT.height,
        layoutWidth: BROWSER_VIEWPORT.width,
        devicePixelRatio: 1,
      });
    }
  });
});

describe("chooseMode", () => {
  it("uses single mode up to 20,000 CSS px", () => {
    expect(chooseMode({ fullHeight: 19_999 })).toBe("single");
    expect(chooseMode({ fullHeight: 20_000 })).toBe("single");
  });

  it("uses tiled mode above 20,000 CSS px", () => {
    expect(chooseMode({ fullHeight: 20_001 })).toBe("tiled");
  });

  it("does not depend on the device pixel ratio", () => {
    expect(chooseMode({ fullHeight: 20_000, devicePixelRatio: 3 } as { fullHeight: number })).toBe("single");
    expect(chooseMode({ fullHeight: 20_001, devicePixelRatio: 1 } as { fullHeight: number })).toBe("tiled");
  });
});

describe("planSingle", () => {
  it("captures the full height of a short page", () => {
    const plan = planSingle({ fullHeight: 5_000, layoutWidth: 1280 });
    expect(plan).toEqual({ offsetY: 0, width: 1280, height: 5_000, truncated: false });
  });

  it("does not truncate at exactly 8,000", () => {
    expect(planSingle({ fullHeight: 8_000, layoutWidth: 1280 })).toMatchObject({ height: 8_000, truncated: false });
  });

  it("truncates at 8,001 and above", () => {
    expect(planSingle({ fullHeight: 8_001, layoutWidth: 1280 })).toMatchObject({ height: 8_000, truncated: true });
    expect(planSingle({ fullHeight: 45_000, layoutWidth: 1280 })).toMatchObject({ height: 8_000, truncated: true });
  });

  it("rounds the layout width and a fractional height up", () => {
    const plan = planSingle({ fullHeight: 1_234.2, layoutWidth: 1265.2 });
    expect(plan.width).toBe(1266);
    expect(plan.height).toBe(1_235);
    expect(plan.offsetY).toBe(0);
  });

  it("clamps the width to 1,280", () => {
    expect(planSingle({ fullHeight: 100, layoutWidth: 1279.5 }).width).toBe(1280);
    expect(planSingle({ fullHeight: 100, layoutWidth: 1280.4 }).width).toBe(1280);
    expect(planSingle({ fullHeight: 100, layoutWidth: 5_000 }).width).toBe(1280);
  });

  it("keeps width and height at least 1", () => {
    expect(planSingle({ fullHeight: 0, layoutWidth: 0 })).toMatchObject({ width: 1, height: 1 });
    expect(planSingle({ fullHeight: Number.NaN, layoutWidth: -5 })).toMatchObject({ width: 1, height: 1 });
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

  it("is true for a box entirely left of x = 0", () => {
    expect(isOutsideImages({ x: -200, y: 10, width: 50, height: 20 }, one)).toBe(true);
  });

  it("is false for a box that starts left of x = 0 and reaches into the image", () => {
    expect(isOutsideImages({ x: -20, y: 10, width: 50, height: 20 }, one)).toBe(false);
  });

  it("is true for a box that only touches the left edge from outside", () => {
    expect(isOutsideImages({ x: -50, y: 10, width: 50, height: 20 }, one)).toBe(true);
  });

  it("is true for a box that only touches the top edge from above", () => {
    expect(isOutsideImages({ x: 10, y: -10, width: 10, height: 10 }, one)).toBe(true);
  });

  it("is true for a box that only touches the top edge of a later tile from above", () => {
    expect(isOutsideImages({ x: 0, y: 700, width: 100, height: 100 }, [{ offsetY: 800, width: 1280, height: 800 }])).toBe(
      true
    );
  });

  it("is false for a box that starts above the image and reaches into it", () => {
    expect(isOutsideImages({ x: 10, y: -5, width: 10, height: 10 }, one)).toBe(false);
  });

  it("is false for a zero-size box inside an image", () => {
    expect(isOutsideImages({ x: 10, y: 10, width: 0, height: 0 }, one)).toBe(false);
    expect(isOutsideImages({ x: 0, y: 0, width: 0, height: 0 }, one)).toBe(false);
  });

  it("is true for a zero-size box outside an image on either axis", () => {
    expect(isOutsideImages({ x: -1, y: 10, width: 0, height: 0 }, one)).toBe(true);
    expect(isOutsideImages({ x: 10, y: 5_000, width: 0, height: 0 }, one)).toBe(true);
    expect(isOutsideImages({ x: 1_280, y: 10, width: 0, height: 0 }, one)).toBe(true);
  });

  it("handles a box with zero width and a size above 0 in height", () => {
    expect(isOutsideImages({ x: 10, y: 10, width: 0, height: 20 }, one)).toBe(false);
    expect(isOutsideImages({ x: 2_000, y: 10, width: 0, height: 20 }, one)).toBe(true);
  });
});

describe("maxBoxDrift", () => {
  const el = (id: string, x: number, y: number, width: number, height: number): ElementSnapshot => ({
    id,
    tag: "div",
    boundingBox: { x, y, width, height },
    color: "",
    backgroundColor: "",
    fontSize: "",
    opacity: "",
    display: "",
    visibility: "",
    position: "",
    checked: false,
    selected: false,
    attributes: {},
  });

  it("returns 0 for equal lists and for empty lists", () => {
    const list = [el("el-1", 1, 2, 3, 4)];
    expect(maxBoxDrift(list, list)).toBe(0);
    expect(maxBoxDrift([], [])).toBe(0);
  });

  it("returns the largest absolute difference over x, y, width and height", () => {
    const a = [el("el-1", 10, 10, 100, 20), el("el-2", 0, 0, 50, 50)];
    const b = [el("el-1", 12, 10, 100, 20), el("el-2", 0, -7, 50, 53)];
    expect(maxBoxDrift(a, b)).toBe(7);
  });

  it("counts a difference in either direction and in width and height", () => {
    expect(maxBoxDrift([el("a", 0, 0, 100, 20)], [el("a", 0, 0, 90, 20)])).toBe(10);
    expect(maxBoxDrift([el("a", 0, 0, 100, 20)], [el("a", 0, 0, 100, 26)])).toBe(6);
    expect(maxBoxDrift([el("a", 9, 0, 100, 20)], [el("a", 3, 0, 100, 20)])).toBe(6);
  });

  it("ignores ids that are in only one list", () => {
    const a = [el("el-1", 0, 0, 10, 10), el("only-a", 0, 0, 10, 10)];
    const b = [el("el-1", 1, 0, 10, 10), el("only-b", 900, 900, 10, 10)];
    expect(maxBoxDrift(a, b)).toBe(1);
  });

  it("returns 0 when no id is shared", () => {
    expect(maxBoxDrift([el("a", 0, 0, 1, 1)], [el("b", 500, 500, 1, 1)])).toBe(0);
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
