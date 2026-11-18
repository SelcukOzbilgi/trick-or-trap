import { describe, it, expect } from "vitest";
import {
  composite,
  contrastRatio,
  effectiveBackground,
  parseColour,
  textContrast,
} from "@/lib/detectors/shared/colour";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";

type Raw = Record<string, unknown>;

function raw(id: string, over: Raw = {}): Raw {
  return {
    id,
    tag: "div",
    text: "Text",
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
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

function indexOf(elements: Raw[]): ElementIndex {
  return buildIndex({ elements }, false);
}

function get(index: ElementIndex, id: string): IndexedElement {
  const el = index.byId(id);
  if (el === undefined) throw new Error(`missing ${id}`);
  return el;
}

describe("parseColour", () => {
  it("reads comma syntax", () => {
    expect(parseColour("rgb(154, 154, 154)")).toEqual({ r: 154, g: 154, b: 154, a: 1 });
    expect(parseColour("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColour("rgba(10, 20, 30, 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("reads space syntax with a slash alpha", () => {
    expect(parseColour("rgb(154 154 154 / 0.5)")).toEqual({ r: 154, g: 154, b: 154, a: 0.5 });
    expect(parseColour("rgb(154 154 154 / 50%)")).toEqual({ r: 154, g: 154, b: 154, a: 0.5 });
    expect(parseColour("rgb(1 2 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it("reads hex forms", () => {
    expect(parseColour("#fff9ee")).toEqual({ r: 255, g: 249, b: 238, a: 1 });
    expect(parseColour("#ABC")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    const withAlpha = parseColour("#11223380");
    expect(withAlpha).not.toBeNull();
    expect(withAlpha?.r).toBe(17);
    expect(withAlpha?.a).toBeCloseTo(128 / 255, 3);
  });

  it("reads transparent and clamps channels", () => {
    expect(parseColour("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColour("  RGB(300, -5, 10, 2) ")).toEqual({ r: 255, g: 0, b: 10, a: 1 });
  });

  it("gives null for junk and non-strings", () => {
    for (const value of [
      "",
      "banana",
      "rgb(1, 2)",
      "rgb(a, b, c)",
      "rgb(1, 2, 3, 4, 5)",
      "#ggg",
      "#12345",
      "color(srgb 1 1 1)",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(parseColour(value), String(value)).toBeNull();
    }
  });

  it("gives null for a 1,000,000-character string, also one that starts like a colour", () => {
    expect(parseColour("a".repeat(1_000_000))).toBeNull();
    expect(parseColour(`rgb(0, 0, 0)${" ".repeat(1_000_000)}`)).toBeNull();
  });
});

describe("composite and contrastRatio", () => {
  it("composites a half-transparent layer over an opaque one", () => {
    const out = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(out.a).toBe(1);
    expect(out.r).toBeCloseTo(127.5, 5);
  });

  it("returns the bottom layer under a fully transparent one", () => {
    const bottom = { r: 10, g: 20, b: 30, a: 0.8 };
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, bottom)).toEqual(bottom);
  });

  it("gives 21 for black on white", () => {
    expect(
      contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })
    ).toBeCloseTo(21, 5);
  });

  it("gives about 2.7 for #9a9a9a on #fff9ee", () => {
    const fg = parseColour("#9a9a9a");
    const bg = parseColour("#fff9ee");
    if (fg === null || bg === null) throw new Error("colours must parse");
    expect(contrastRatio(fg, bg)).toBeCloseTo(2.7, 1);
  });

  it("is symmetric in light and dark and 1 for equal colours", () => {
    const grey = { r: 120, g: 120, b: 120, a: 1 };
    expect(contrastRatio(grey, grey)).toBeCloseTo(1, 5);
  });
});

describe("effectiveBackground", () => {
  it("uses an opaque own background without assuming anything", () => {
    const index = indexOf([raw("el-1", { backgroundColor: "rgb(10, 20, 30)" })]);
    const bg = effectiveBackground(index, get(index, "el-1"));
    expect(bg.colour).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(bg.assumed).toBe(false);
  });

  it("takes the colour from the nearest opaque ancestor in the sample", () => {
    const index = indexOf([
      raw("el-1", { backgroundColor: "rgb(255, 249, 238)" }),
      raw("el-1-0"),
      raw("el-1-0-0"),
    ]);
    const bg = effectiveBackground(index, get(index, "el-1-0-0"));
    expect(bg.colour).toEqual({ r: 255, g: 249, b: 238, a: 1 });
    expect(bg.assumed).toBe(false);
  });

  it("composites translucent layers down to an opaque ancestor", () => {
    const index = indexOf([
      raw("el-1", { backgroundColor: "rgb(255, 255, 255)" }),
      raw("el-1-0", { backgroundColor: "rgba(0, 0, 0, 0.5)" }),
      raw("el-1-0-0"),
    ]);
    const bg = effectiveBackground(index, get(index, "el-1-0-0"));
    expect(bg.colour.r).toBeCloseTo(127.5, 5);
    expect(bg.colour.a).toBe(1);
    expect(bg.assumed).toBe(false);
  });

  it("falls back to white and says so when no layer is opaque", () => {
    const index = indexOf([raw("el-1"), raw("el-1-0")]);
    const bg = effectiveBackground(index, get(index, "el-1-0"));
    expect(bg.colour).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(bg.assumed).toBe(true);
  });

  it("composites a translucent layer over white and still reports it as assumed", () => {
    const index = indexOf([raw("el-1", { backgroundColor: "rgba(0, 0, 0, 0.5)" })]);
    const bg = effectiveBackground(index, get(index, "el-1"));
    expect(bg.colour.r).toBeCloseTo(127.5, 5);
    expect(bg.assumed).toBe(true);
  });

  it("ignores a background that does not parse", () => {
    const index = indexOf([
      raw("el-1", { backgroundColor: "rgb(1, 2, 3)" }),
      raw("el-1-0", { backgroundColor: "not-a-colour" }),
    ]);
    const bg = effectiveBackground(index, get(index, "el-1-0"));
    expect(bg.colour).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(bg.assumed).toBe(false);
  });

  it("looks at no more than eight layers", () => {
    const elements: Raw[] = [raw("el-1", { backgroundColor: "rgb(9, 9, 9)" })];
    let id = "el-1";
    for (let i = 0; i < 9; i += 1) {
      id = `${id}-0`;
      elements.push(raw(id));
    }
    const index = indexOf(elements);
    const bg = effectiveBackground(index, get(index, id));
    expect(bg.assumed).toBe(true);
  });
});

describe("textContrast", () => {
  const page = (child: Raw): Raw[] => [
    raw("el-1", { backgroundColor: "rgb(255, 249, 238)" }),
    child,
  ];

  it("measures grey text on the page colour", () => {
    const index = indexOf(page(raw("el-1-0", { color: "rgb(154, 154, 154)" })));
    const result = textContrast(index, get(index, "el-1-0"));
    expect(result).not.toBeNull();
    expect(result?.ratio).toBeCloseTo(2.7, 1);
    expect(result?.assumed).toBe(false);
  });

  it("is lowered by the element's opacity", () => {
    const full = indexOf(page(raw("el-1-0", { color: "#b3b3b3" })));
    const faded = indexOf(page(raw("el-1-0", { color: "#b3b3b3", opacity: "0.6" })));
    const a = textContrast(full, get(full, "el-1-0"));
    const b = textContrast(faded, get(faded, "el-1-0"));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.ratio).toBeLessThan(a!.ratio);
    expect(b!.ratio).toBeLessThan(2);
  });

  it("is lowered by the opacity of an ancestor in the sample", () => {
    const index = indexOf([
      raw("el-1", { backgroundColor: "rgb(255, 255, 255)", opacity: "0.5" }),
      raw("el-1-0", { color: "rgb(0, 0, 0)" }),
    ]);
    const result = textContrast(index, get(index, "el-1-0"));
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeLessThan(21);
    expect(result!.ratio).toBeCloseTo(3.98, 1);
  });

  it("uses the alpha of the text colour", () => {
    const index = indexOf(page(raw("el-1-0", { color: "rgba(0, 0, 0, 0.5)" })));
    const half = textContrast(index, get(index, "el-1-0"));
    const solid = textContrast(
      indexOf(page(raw("el-1-0", { color: "rgb(0, 0, 0)" }))),
      get(indexOf(page(raw("el-1-0", { color: "rgb(0, 0, 0)" }))), "el-1-0")
    );
    expect(half!.ratio).toBeLessThan(solid!.ratio);
  });

  it("reports an assumed background", () => {
    const index = indexOf([raw("el-1", { color: "rgb(0, 0, 0)" })]);
    const result = textContrast(index, get(index, "el-1"));
    expect(result?.assumed).toBe(true);
    expect(result?.ratio).toBeCloseTo(21, 3);
  });

  it("gives null when the text colour does not parse", () => {
    const index = indexOf([raw("el-1", { color: "nonsense" })]);
    expect(textContrast(index, get(index, "el-1"))).toBeNull();
  });
});
