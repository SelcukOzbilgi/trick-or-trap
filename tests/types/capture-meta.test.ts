import { describe, it, expect } from "vitest";
import {
  BaseSnapshotSchema,
  PageSnapshotSchema,
  CaptureMetaSchema,
  ElementSnapshotSchema,
} from "@/lib/types";
import {
  MAX_ATTR_CHARS,
  MAX_ATTR_NAME_CHARS,
  MAX_ATTRS_PER_ELEMENT,
  MAX_ELEMENT_ID_CHARS,
  MAX_ELEMENTS,
  MAX_HOP_URL_LENGTH,
  MAX_ROLE_CHARS,
  MAX_STYLE_CHARS,
  MAX_TAG_CHARS,
  MAX_TILES,
} from "@/lib/capture/constants";

// ── Shared fixtures (same shapes as tests/types/schemas.test.ts) ───────────

const validBoundingBox = { x: 0, y: 0, width: 100, height: 50 };

const validElement = {
  id: "el-1",
  tag: "div",
  boundingBox: validBoundingBox,
  color: "rgb(0,0,0)",
  backgroundColor: "rgb(255,255,255)",
  fontSize: "16px",
  opacity: "1",
  display: "block",
  visibility: "visible",
  position: "static",
  checked: false,
  selected: false,
};

const validBaseSnapshot = {
  url: "https://example.com",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [validElement],
};

const validMetaWithoutImages = {
  devicePixelRatio: 2,
  scrollX: 0,
  scrollY: 0,
  eligibleElementCount: 12,
  elementsTruncated: false,
  light: false,
};

const validImages = {
  mode: "single" as const,
  truncated: false,
  items: [{ offsetY: 0, width: 1280, height: 3000 }],
};

const validMetaWithImages = { ...validMetaWithoutImages, images: validImages };

function withCapture(capture: unknown) {
  return { ...validBaseSnapshot, capture };
}

// ── Old shape ──────────────────────────────────────────────────────────────

describe("old-shape snapshots (14.3, 14.5)", () => {
  it("parses with PageSnapshotSchema", () => {
    expect(() => PageSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
  });

  it("parses with BaseSnapshotSchema", () => {
    expect(() => BaseSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
  });

  it("adds no new key to the parsed output", () => {
    const parsed = BaseSnapshotSchema.parse(validBaseSnapshot);
    expect(parsed).toEqual(validBaseSnapshot);
    expect(parsed).not.toHaveProperty("capture");
  });
});

// ── Element fields ─────────────────────────────────────────────────────────

describe("ElementSnapshotSchema extension (14.1)", () => {
  it("accepts attributes, textTruncated and outsideImage and keeps them", () => {
    const element = {
      ...validElement,
      attributes: { type: "checkbox", "aria-label": "Newsletter" },
      textTruncated: true,
      outsideImage: false,
    };
    const parsed = BaseSnapshotSchema.parse({
      ...validBaseSnapshot,
      elements: [element],
    });
    expect(parsed.elements[0].attributes).toEqual({
      type: "checkbox",
      "aria-label": "Newsletter",
    });
    expect(parsed.elements[0].textTruncated).toBe(true);
    expect(parsed.elements[0].outsideImage).toBe(false);
  });

  it("accepts an empty attributes object", () => {
    const element = { ...validElement, attributes: {} };
    expect(() =>
      BaseSnapshotSchema.parse({ ...validBaseSnapshot, elements: [element] })
    ).not.toThrow();
  });

  it("rejects attributes with a number value (14.4)", () => {
    const element = { ...validElement, attributes: { tabindex: 1 } };
    expect(() =>
      BaseSnapshotSchema.parse({ ...validBaseSnapshot, elements: [element] })
    ).toThrow();
  });

  it('rejects textTruncated: "yes" (14.4)', () => {
    const element = { ...validElement, textTruncated: "yes" };
    expect(() =>
      BaseSnapshotSchema.parse({ ...validBaseSnapshot, elements: [element] })
    ).toThrow();
  });

  it("rejects a non-boolean outsideImage (14.4)", () => {
    const element = { ...validElement, outsideImage: 1 };
    expect(() =>
      BaseSnapshotSchema.parse({ ...validBaseSnapshot, elements: [element] })
    ).toThrow();
  });
});

// ── capture field ──────────────────────────────────────────────────────────

describe("capture metadata (14.2)", () => {
  it("parses capture without images", () => {
    const parsed = BaseSnapshotSchema.parse(withCapture(validMetaWithoutImages));
    expect(parsed.capture).toEqual(validMetaWithoutImages);
  });

  it("parses capture with images", () => {
    const parsed = BaseSnapshotSchema.parse(withCapture(validMetaWithImages));
    expect(parsed.capture?.images?.items).toHaveLength(1);
    expect(parsed.capture?.images?.mode).toBe("single");
  });

  it("parses tiled mode with several items and a truncated flag", () => {
    const images = {
      mode: "tiled" as const,
      truncated: true,
      items: [
        { offsetY: 0, width: 1280, height: 800 },
        { offsetY: 800, width: 1280, height: 800 },
      ],
    };
    expect(() =>
      BaseSnapshotSchema.parse(withCapture({ ...validMetaWithoutImages, images }))
    ).not.toThrow();
  });

  it("parses at the top level of PageSnapshotSchema", () => {
    const parsed = PageSnapshotSchema.parse(withCapture(validMetaWithImages));
    expect(parsed.capture?.devicePixelRatio).toBe(2);
  });

  it("parses inside afterReload, with and without images", () => {
    const light = { ...validMetaWithoutImages, light: true };
    const a = PageSnapshotSchema.parse({
      ...validBaseSnapshot,
      afterReload: withCapture(light),
    });
    expect(a.afterReload?.capture?.light).toBe(true);

    const b = PageSnapshotSchema.parse({
      ...validBaseSnapshot,
      capture: validMetaWithImages,
      afterReload: withCapture(validMetaWithImages),
    });
    expect(b.afterReload?.capture?.images?.mode).toBe("single");
  });

  it("parses inside secondSample", () => {
    expect(() =>
      PageSnapshotSchema.parse({
        ...validBaseSnapshot,
        secondSample: withCapture(validMetaWithoutImages),
      })
    ).not.toThrow();
  });

  it("exports CaptureMetaSchema that parses valid metadata", () => {
    expect(() => CaptureMetaSchema.parse(validMetaWithImages)).not.toThrow();
  });
});

// ── Rejections (14.4) ──────────────────────────────────────────────────────

describe("capture metadata rejections (14.4)", () => {
  const bad: [string, unknown][] = [
    ["devicePixelRatio 0", { ...validMetaWithoutImages, devicePixelRatio: 0 }],
    [
      "eligibleElementCount -1",
      { ...validMetaWithoutImages, eligibleElementCount: -1 },
    ],
    [
      "eligibleElementCount 1.5",
      { ...validMetaWithoutImages, eligibleElementCount: 1.5 },
    ],
    [
      "images item width 0",
      {
        ...validMetaWithoutImages,
        images: { ...validImages, items: [{ offsetY: 0, width: 0, height: 10 }] },
      },
    ],
    [
      'images mode "other"',
      { ...validMetaWithoutImages, images: { ...validImages, mode: "other" } },
    ],
    [
      "images with empty items",
      { ...validMetaWithoutImages, images: { ...validImages, items: [] } },
    ],
    [
      "negative offsetY",
      {
        ...validMetaWithoutImages,
        images: {
          ...validImages,
          items: [{ offsetY: -1, width: 10, height: 10 }],
        },
      },
    ],
  ];

  it.each(bad)("rejects %s", (_name, capture) => {
    expect(() => BaseSnapshotSchema.parse(withCapture(capture))).toThrow();
    expect(() => PageSnapshotSchema.parse(withCapture(capture))).toThrow();
  });

  it("rejects a bad capture inside afterReload", () => {
    expect(() =>
      PageSnapshotSchema.parse({
        ...validBaseSnapshot,
        afterReload: withCapture({
          ...validMetaWithoutImages,
          devicePixelRatio: 0,
        }),
      })
    ).toThrow();
  });
});

// ── Schema limits (page-capture-fixes, 6.6 to 6.9) ─────────────────────────
// The schema literals are separate from the capture constants (lib/types must not
// import lib/capture). These tests tie the two together at the boundary.

const MAX_TEXT_SCHEMA = 1_000;
const MAX_ELIGIBLE_COUNT = 10_000_000;

function elementWith(patch: Record<string, unknown>) {
  return { ...validElement, ...patch };
}

function metaWith(patch: Record<string, unknown>) {
  return { ...validMetaWithoutImages, ...patch };
}

function itemsOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({ offsetY: i * 800, width: 1280, height: 800 }));
}

describe("element limits (6.6, 6.7)", () => {
  const limits: [string, string, number][] = [
    ["id", "id", MAX_ELEMENT_ID_CHARS],
    ["tag", "tag", MAX_TAG_CHARS],
    ["role", "role", MAX_ROLE_CHARS],
    ["text", "text", MAX_TEXT_SCHEMA],
    ["color", "color", MAX_STYLE_CHARS],
    ["backgroundColor", "backgroundColor", MAX_STYLE_CHARS],
    ["fontSize", "fontSize", MAX_STYLE_CHARS],
    ["opacity", "opacity", MAX_STYLE_CHARS],
    ["display", "display", MAX_STYLE_CHARS],
    ["visibility", "visibility", MAX_STYLE_CHARS],
    ["position", "position", MAX_STYLE_CHARS],
  ];

  it.each(limits)("accepts %s at the limit and rejects one over", (_name, key, limit) => {
    expect(ElementSnapshotSchema.safeParse(elementWith({ [key]: "a".repeat(limit) })).success).toBe(true);
    expect(ElementSnapshotSchema.safeParse(elementWith({ [key]: "a".repeat(limit + 1) })).success).toBe(false);
  });

  it("uses the capture constants for id, tag, role and style strings", () => {
    expect(MAX_ELEMENT_ID_CHARS).toBe(2_048);
    expect(MAX_TAG_CHARS).toBe(64);
    expect(MAX_ROLE_CHARS).toBe(64);
    expect(MAX_STYLE_CHARS).toBe(64);
  });

  it("accepts 32 attributes and rejects 33", () => {
    const make = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`aria-a${i}`, "v"]));
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: make(MAX_ATTRS_PER_ELEMENT) })).success).toBe(true);
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: make(MAX_ATTRS_PER_ELEMENT + 1) })).success).toBe(false);
  });

  it("accepts an attribute name of 64 characters and rejects 65", () => {
    const at = { ["n".repeat(MAX_ATTR_NAME_CHARS)]: "v" };
    const over = { ["n".repeat(MAX_ATTR_NAME_CHARS + 1)]: "v" };
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: at })).success).toBe(true);
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: over })).success).toBe(false);
  });

  it("accepts an attribute value of 200 characters and rejects 201", () => {
    const at = { "aria-label": "v".repeat(MAX_ATTR_CHARS) };
    const over = { "aria-label": "v".repeat(MAX_ATTR_CHARS + 1) };
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: at })).success).toBe(true);
    expect(ElementSnapshotSchema.safeParse(elementWith({ attributes: over })).success).toBe(false);
  });
});

describe("snapshot limits (6.6)", () => {
  it("accepts 1,500 elements and rejects 1,501", () => {
    const make = (count: number) => ({
      ...validBaseSnapshot,
      elements: Array.from({ length: count }, (_, i) => ({ ...validElement, id: `el-${i}` })),
    });
    expect(BaseSnapshotSchema.safeParse(make(MAX_ELEMENTS)).success).toBe(true);
    expect(BaseSnapshotSchema.safeParse(make(MAX_ELEMENTS + 1)).success).toBe(false);
  });

  it("accepts a url of 8,192 characters and rejects 8,193", () => {
    const prefix = "https://example.com/";
    const make = (length: number) => ({ ...validBaseSnapshot, url: prefix + "a".repeat(length - prefix.length) });
    expect(BaseSnapshotSchema.safeParse(make(MAX_HOP_URL_LENGTH)).success).toBe(true);
    expect(BaseSnapshotSchema.safeParse(make(MAX_HOP_URL_LENGTH + 1)).success).toBe(false);
  });

  it("applies the limits inside afterReload and secondSample", () => {
    const bad = { ...validBaseSnapshot, elements: [elementWith({ tag: "t".repeat(MAX_TAG_CHARS + 1) })] };
    expect(PageSnapshotSchema.safeParse({ ...validBaseSnapshot, afterReload: bad }).success).toBe(false);
    expect(PageSnapshotSchema.safeParse({ ...validBaseSnapshot, secondSample: bad }).success).toBe(false);
  });
});

describe("capture metadata limits (6.8)", () => {
  it("accepts devicePixelRatio 16 and rejects above 16", () => {
    expect(CaptureMetaSchema.safeParse(metaWith({ devicePixelRatio: 16 })).success).toBe(true);
    expect(CaptureMetaSchema.safeParse(metaWith({ devicePixelRatio: 16.01 })).success).toBe(false);
  });

  it("accepts layoutWidth 100,000 and rejects 100,001", () => {
    expect(CaptureMetaSchema.safeParse(metaWith({ layoutWidth: 100_000 })).success).toBe(true);
    expect(CaptureMetaSchema.safeParse(metaWith({ layoutWidth: 100_001 })).success).toBe(false);
  });

  it("accepts a missing layoutWidth and a positive one", () => {
    expect(CaptureMetaSchema.safeParse(validMetaWithoutImages).success).toBe(true);
    expect(CaptureMetaSchema.safeParse(metaWith({ layoutWidth: 1265 })).success).toBe(true);
  });

  it.each([0, -1])("rejects layoutWidth %s", (layoutWidth) => {
    expect(CaptureMetaSchema.safeParse(metaWith({ layoutWidth })).success).toBe(false);
  });

  it("keeps layoutWidth in the parsed output", () => {
    expect(CaptureMetaSchema.parse(metaWith({ layoutWidth: 1265 })).layoutWidth).toBe(1265);
  });

  it("accepts 10 image items and rejects 11", () => {
    const images = (count: number) => ({ mode: "tiled" as const, truncated: false, items: itemsOf(count) });
    expect(CaptureMetaSchema.safeParse(metaWith({ images: images(MAX_TILES) })).success).toBe(true);
    expect(CaptureMetaSchema.safeParse(metaWith({ images: images(MAX_TILES + 1) })).success).toBe(false);
  });

  it("accepts an eligible count of 10,000,000 and rejects one more", () => {
    expect(CaptureMetaSchema.safeParse(metaWith({ eligibleElementCount: MAX_ELIGIBLE_COUNT })).success).toBe(true);
    expect(CaptureMetaSchema.safeParse(metaWith({ eligibleElementCount: MAX_ELIGIBLE_COUNT + 1 })).success).toBe(false);
  });

  it("still rejects a devicePixelRatio of 0", () => {
    expect(CaptureMetaSchema.safeParse(metaWith({ devicePixelRatio: 0 })).success).toBe(false);
  });
});

describe("old shapes still parse (6.9)", () => {
  it("parses a snapshot with the old capture metadata and no layoutWidth", () => {
    const parsed = PageSnapshotSchema.parse(withCapture(validMetaWithImages));
    expect(parsed.capture?.layoutWidth).toBeUndefined();
  });

  it("parses an element with long but allowed text from an older fixture", () => {
    const element = elementWith({ text: "x".repeat(300), attributes: { type: "checkbox" } });
    expect(ElementSnapshotSchema.safeParse(element).success).toBe(true);
  });
});
