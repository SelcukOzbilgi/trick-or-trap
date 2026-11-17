import { describe, it, expect } from "vitest";
import { perLoadValues } from "@/lib/boo-tique/per-load";

/** Returns the given numbers in order, then repeats the last one. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe("perLoadValues", () => {
  it("gives the lowest stock and viewers for a random source of 0", () => {
    expect(perLoadValues(() => 0)).toEqual({ stockLeft: 2, viewers: 8 });
  });

  it("gives the highest stock and viewers just below 1", () => {
    expect(perLoadValues(() => 0.999999)).toEqual({ stockLeft: 9, viewers: 48 });
  });

  it("keeps every result inside 2..9 stock and 8..48 viewers", () => {
    for (let i = 0; i <= 100; i += 1) {
      const { stockLeft, viewers } = perLoadValues(() => i / 101);
      expect(stockLeft).toBeGreaterThanOrEqual(2);
      expect(stockLeft).toBeLessThanOrEqual(9);
      expect(viewers).toBeGreaterThanOrEqual(8);
      expect(viewers).toBeLessThanOrEqual(48);
    }
  });

  it("depends only on the injected function", () => {
    const first = perLoadValues(sequence(0.5, 0.25));
    const again = perLoadValues(sequence(0.5, 0.25));
    expect(again).toEqual(first);
    expect(first).toEqual({ stockLeft: 2 + Math.floor(0.5 * 8), viewers: 8 + Math.floor(0.25 * 41) });
  });

  it("uses the first draw for stock and the second for viewers", () => {
    expect(perLoadValues(sequence(0, 0.999999))).toEqual({ stockLeft: 2, viewers: 48 });
    expect(perLoadValues(sequence(0.999999, 0))).toEqual({ stockLeft: 9, viewers: 8 });
  });

  it("gives different values for different sources", () => {
    expect(perLoadValues(() => 0.1)).not.toEqual(perLoadValues(() => 0.9));
  });
});

describe("product page module", () => {
  it("exports dynamic equal to force-dynamic", async () => {
    const mod = await import("@/app/boo-tique/product/[slug]/page");
    expect(mod.dynamic).toBe("force-dynamic");
  });

  it("exports a default page function", async () => {
    const mod = await import("@/app/boo-tique/product/[slug]/page");
    expect(typeof mod.default).toBe("function");
  });
});
