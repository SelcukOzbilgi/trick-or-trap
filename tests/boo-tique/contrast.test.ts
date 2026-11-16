import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "@/lib/boo-tique/contrast";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("accepts upper-case hex", () => {
    expect(relativeLuminance("#B3B3B3")).toBeCloseTo(relativeLuminance("#b3b3b3"), 12);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
  });

  it("is 1 for two equal colours", () => {
    expect(contrastRatio("#8b1a1a", "#8b1a1a")).toBeCloseTo(1, 10);
    expect(contrastRatio("#fbf3e4", "#fbf3e4")).toBeCloseTo(1, 10);
  });

  it("gives about 4.54 for #767676 on white", () => {
    const ratio = contrastRatio("#767676", "#ffffff");
    expect(ratio).toBeGreaterThan(4.5);
    expect(ratio).toBeLessThan(4.6);
  });

  it("gives 1.9 to 2.1 for the ghost-reject pair (#b3b3b3 on #fff9ee)", () => {
    const ratio = contrastRatio("#b3b3b3", "#fff9ee");
    expect(ratio).toBeGreaterThanOrEqual(1.9);
    expect(ratio).toBeLessThanOrEqual(2.1);
  });

  it("does not depend on the order of the arguments", () => {
    expect(contrastRatio("#b3b3b3", "#fff9ee")).toBe(contrastRatio("#fff9ee", "#b3b3b3"));
    expect(contrastRatio("#000000", "#ffffff")).toBe(contrastRatio("#ffffff", "#000000"));
  });
});
