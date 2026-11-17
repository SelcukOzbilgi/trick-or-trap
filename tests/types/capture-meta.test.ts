import { describe, it, expect } from "vitest";
import {
  BaseSnapshotSchema,
  PageSnapshotSchema,
  CaptureMetaSchema,
} from "@/lib/types";

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
