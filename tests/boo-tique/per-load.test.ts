import { describe, it, expect } from "vitest";
import { perLoadValues, STOCK_VALUES } from "@/lib/boo-tique/per-load";
import { INVENTORY } from "@/lib/boo-tique/content";
import {
  SOLD_TOAST_INTERVAL_MS,
  SOLD_TOAST_MESSAGES,
  nextToastIndex,
} from "@/lib/boo-tique/countdown";

/** Returns the given numbers in order, then repeats the last one. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe("STOCK_VALUES", () => {
  it("is the integers 2 to 9 without the real inventory of the Travel tin", () => {
    const expected: number[] = [];
    for (let n = 2; n <= 9; n += 1) {
      if (n !== INVENTORY["travel-tin"]) expected.push(n);
    }
    expect([...STOCK_VALUES]).toEqual(expected);
    expect([...STOCK_VALUES]).toEqual([2, 4, 5, 6, 7, 8, 9]);
  });
});

describe("perLoadValues", () => {
  it("never returns the real inventory and returns every stock value over a grid of draws", () => {
    const seen = new Set<number>();
    const draws: number[] = [];
    for (let i = 0; i < 10000; i += 1) draws.push(i / 10000);
    draws.push(0.999999);
    for (const draw of draws) {
      const { stockLeft } = perLoadValues(() => draw);
      expect(stockLeft).not.toBe(INVENTORY["travel-tin"]);
      seen.add(stockLeft);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...STOCK_VALUES]);
  });

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
    expect(first).toEqual({
      stockLeft: STOCK_VALUES[Math.floor(0.5 * 7)],
      viewers: 8 + Math.floor(0.25 * 41),
    });
    expect(first).toEqual({ stockLeft: 6, viewers: 18 });
  });

  it("uses the first draw for stock and the second for viewers", () => {
    expect(perLoadValues(sequence(0, 0.999999))).toEqual({ stockLeft: 2, viewers: 48 });
    expect(perLoadValues(sequence(0.999999, 0))).toEqual({ stockLeft: 9, viewers: 8 });
  });

  it("gives different values for different sources", () => {
    expect(perLoadValues(() => 0.1)).not.toEqual(perLoadValues(() => 0.9));
  });
});

describe("sold toast helpers", () => {
  it("has four fixed messages", () => {
    expect(SOLD_TOAST_MESSAGES).toHaveLength(4);
    expect(new Set(SOLD_TOAST_MESSAGES).size).toBe(4);
  });

  it("starts with the Morgan message", () => {
    expect(SOLD_TOAST_MESSAGES[0]).toBe("Morgan from Ohio just bought the Cursed Candle Set");
  });

  it("rotates every 6000 ms", () => {
    expect(SOLD_TOAST_INTERVAL_MS).toBe(6000);
  });

  it("moves to the next index and wraps around", () => {
    expect(nextToastIndex(0, 4)).toBe(1);
    expect(nextToastIndex(2, 4)).toBe(3);
    expect(nextToastIndex(3, 4)).toBe(0);
  });

  it("returns 0 for an empty list and for an out-of-range index", () => {
    expect(nextToastIndex(0, 0)).toBe(0);
    expect(nextToastIndex(9, 4)).toBe(0);
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
