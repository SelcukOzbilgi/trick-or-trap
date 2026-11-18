import { describe, it, expect } from "vitest";
import { parsePrices } from "@/lib/detectors/shared/price";
import type { Price } from "@/lib/detectors/shared/price";
import { tokenise } from "@/lib/detectors/shared/text";

function prices(text: string): readonly Price[] {
  return parsePrices(tokenise(text));
}

function only(text: string): Price {
  const found = prices(text);
  expect(found, text).toHaveLength(1);
  return found[0];
}

describe("parsePrices: symbols before the number", () => {
  it("reads +$4.99 as 499 minor units with a plus", () => {
    const price = only("Add protection +$4.99");
    expect(price.minor).toBe(499);
    expect(price.plus).toBe(true);
    expect(price.currency).toBe("$");
  });

  it("reads a price without a plus", () => {
    const price = only("Gold warranty $9.00");
    expect(price.minor).toBe(900);
    expect(price.plus).toBe(false);
  });

  it("reads $1,299.90 as 129990", () => {
    expect(only("Total $1,299.90").minor).toBe(129990);
  });

  it("reads a whole amount with a thousands separator", () => {
    expect(only("$1,299").minor).toBe(129900);
  });

  it("reads ₺1.299,90 as 129990", () => {
    const price = only("₺1.299,90");
    expect(price.minor).toBe(129990);
    expect(price.currency).toBe("₺");
  });

  it("reads €4,99 as 499 and a plus before the symbol", () => {
    const price = only("Gift wrap + €4,99");
    expect(price.minor).toBe(499);
    expect(price.plus).toBe(true);
  });

  it("reads a whole number with a symbol", () => {
    expect(only("Gift wrap +$2").minor).toBe(200);
  });
});

describe("parsePrices: symbols and codes after the number", () => {
  it("reads 4,99 TL as 499", () => {
    const price = only("Kargo 4,99 TL");
    expect(price.minor).toBe(499);
    expect(price.currency).toBe("tl");
  });

  it("reads 4.99 € as 499", () => {
    expect(only("Extra 4.99 €").minor).toBe(499);
  });

  it("reads a plus directly before the number when the symbol follows", () => {
    const price = only("Versand +4,99 €");
    expect(price.minor).toBe(499);
    expect(price.plus).toBe(true);
  });

  it("reads a currency code before the number", () => {
    expect(only("Fee USD 12").minor).toBe(1200);
    expect(only("EUR 3,50").minor).toBe(350);
  });

  it("reads TRY only in capitals, so the English verb is not a currency", () => {
    expect(only("Fee TRY 12").minor).toBe(1200);
    expect(prices("try 12 free months")).toEqual([]);
  });
});

describe("parsePrices: things that are not prices", () => {
  it("finds no price in a size", () => {
    expect(prices("Size 42")).toEqual([]);
  });

  it("finds none in Free or Ücretsiz (the detector turns those into 0)", () => {
    expect(prices("Free")).toEqual([]);
    expect(prices("Ücretsiz")).toEqual([]);
  });

  it("finds none in a clock or a bare number", () => {
    expect(prices("Ends in 04:59:59")).toEqual([]);
    expect(prices("2 items")).toEqual([]);
  });

  it("ignores amounts over the limit and keeps the one at the limit", () => {
    expect(prices("$1,000,000")).toEqual([]);
    expect(prices("$100,000.01")).toEqual([]);
    expect(only("$100,000.00").minor).toBe(10_000_000);
  });

  it("ignores a number with an odd digit grouping", () => {
    expect(prices("$1,23,456")).toEqual([]);
  });

  it("handles non-token inputs without throwing", () => {
    expect(parsePrices([])).toEqual([]);
    expect(parsePrices(null as unknown as never)).toEqual([]);
  });
});

describe("parsePrices: several prices", () => {
  it("returns every price in text order with its token range", () => {
    const text = "Premium +$9.00 or standard $4.00";
    const tokens = tokenise(text);
    const found = parsePrices(tokens);
    expect(found.map((p) => p.minor)).toEqual([900, 400]);
    expect(found[0].plus).toBe(true);
    expect(found[1].plus).toBe(false);
    expect(found[0].start).toBeLessThan(found[0].end);
    expect(tokens.slice(found[0].start, found[0].end).map((t) => t.surface).join("")).toBe(
      "+$9.00"
    );
  });
});
