import { describe, expect, it } from "vitest";
import { buildSample, collectInPage } from "@/lib/capture/extractor";
import {
  MAX_ATTR_CHARS,
  MAX_ELEMENTS,
  MAX_ELEMENTS_LIGHT,
  MAX_TEXT_CHARS,
  MAX_TEXT_CHARS_LIGHT,
} from "@/lib/capture/constants";
import type { RawElement, RawPageRead } from "@/lib/capture/types";
import { BaseSnapshotSchema } from "@/lib/types";

const CAPTURED_AT = "2025-10-31T12:00:00.000Z";
const URL_ = "https://shop.example.com/page";

function rawEl(overrides: Partial<RawElement> = {}): RawElement {
  return {
    path: [1, 0, 3],
    tag: "div",
    role: null,
    text: "Hello",
    textTruncated: false,
    rect: { left: 10, top: 20, width: 100, height: 30 },
    style: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      opacity: "1",
      display: "block",
      visibility: "visible",
      position: "static",
    },
    checked: false,
    selected: false,
    attrs: {},
    ...overrides,
  };
}

function rawPage(elements: RawElement[], overrides: Partial<RawPageRead> = {}): RawPageRead {
  return {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    scrollWidth: 1280,
    scrollHeight: 3_000,
    eligibleCount: elements.length,
    elements,
    ...overrides,
  };
}

const full = { light: false, url: URL_, capturedAt: CAPTURED_AT } as const;
const light = { light: true, url: URL_, capturedAt: CAPTURED_AT } as const;

describe("buildSample: ids and boxes", () => {
  it("builds ids from the path joined by dashes", () => {
    const snap = buildSample(rawPage([rawEl({ path: [1, 0, 3] }), rawEl({ path: [2] })]), full);
    expect(snap.elements.map((e) => e.id)).toEqual(["el-1-0-3", "el-2"]);
  });

  it("gives the same ids in a full and a light sample of the same raw data", () => {
    const raw = rawPage([rawEl({ path: [0, 4] }), rawEl({ path: [1, 2, 2] })]);
    const a = buildSample(raw, full).elements.map((e) => e.id);
    const b = buildSample(raw, light).elements.map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("converts boxes to document pixels with the scroll offsets", () => {
    const raw = rawPage([rawEl({ rect: { left: 10, top: 20, width: 5, height: 6 } })], { scrollX: 3, scrollY: 100 });
    const snap = buildSample(raw, full);
    expect(snap.elements[0]?.boundingBox).toEqual({ x: 13, y: 120, width: 5, height: 6 });
    expect(snap.capture?.scrollX).toBe(3);
    expect(snap.capture?.scrollY).toBe(100);
  });

  it("replaces non-finite numbers and negative sizes and rounds to two decimals", () => {
    const raw = rawPage(
      [rawEl({ rect: { left: Number.NaN, top: 1.2345, width: -4, height: Number.POSITIVE_INFINITY } })],
      { innerWidth: 1280.456, scrollHeight: Number.NaN }
    );
    const snap = buildSample(raw, full);
    expect(snap.elements[0]?.boundingBox).toEqual({ x: 0, y: 1.23, width: 0, height: 0 });
    expect(snap.viewportWidth).toBe(1280.46);
    expect(snap.fullHeight).toBe(0);
  });
});

describe("buildSample: caps", () => {
  it("keeps the first 1,500 elements of a full sample", () => {
    const many = Array.from({ length: MAX_ELEMENTS + 5 }, (_, i) => rawEl({ path: [i] }));
    const snap = buildSample(rawPage(many), full);
    expect(snap.elements).toHaveLength(MAX_ELEMENTS);
    expect(snap.elements[0]?.id).toBe("el-0");
    expect(snap.elements[MAX_ELEMENTS - 1]?.id).toBe(`el-${MAX_ELEMENTS - 1}`);
    expect(snap.capture?.elementsTruncated).toBe(true);
    expect(snap.capture?.eligibleElementCount).toBe(MAX_ELEMENTS + 5);
  });

  it("keeps the first 750 elements of a light sample", () => {
    const many = Array.from({ length: 1_000 }, (_, i) => rawEl({ path: [i] }));
    const snap = buildSample(rawPage(many), light);
    expect(snap.elements).toHaveLength(MAX_ELEMENTS_LIGHT);
    expect(snap.capture?.elementsTruncated).toBe(true);
    expect(snap.capture?.light).toBe(true);
  });

  it("does not flag truncation when everything fits", () => {
    const snap = buildSample(rawPage([rawEl()]), full);
    expect(snap.capture?.elementsTruncated).toBe(false);
    expect(snap.capture?.eligibleElementCount).toBe(1);
    expect(snap.capture?.light).toBe(false);
  });

  it("flags truncation when the page itself stopped at its cap", () => {
    const snap = buildSample(rawPage([rawEl()], { eligibleCount: 40 }), full);
    expect(snap.capture?.elementsTruncated).toBe(true);
    expect(snap.capture?.eligibleElementCount).toBe(40);
  });

  it("cuts text at 300 characters in a full sample and sets textTruncated", () => {
    const snap = buildSample(rawPage([rawEl({ text: "a".repeat(MAX_TEXT_CHARS + 50) })]), full);
    expect(snap.elements[0]?.text).toHaveLength(MAX_TEXT_CHARS);
    expect(snap.elements[0]?.textTruncated).toBe(true);
  });

  it("cuts text at 120 characters in a light sample", () => {
    const snap = buildSample(rawPage([rawEl({ text: "b".repeat(300) })]), light);
    expect(snap.elements[0]?.text).toHaveLength(MAX_TEXT_CHARS_LIGHT);
    expect(snap.elements[0]?.textTruncated).toBe(true);
  });

  it("keeps the textTruncated flag set by the page", () => {
    const snap = buildSample(rawPage([rawEl({ text: "short", textTruncated: true })]), full);
    expect(snap.elements[0]?.textTruncated).toBe(true);
  });

  it("does not set textTruncated for text within the cap", () => {
    const snap = buildSample(rawPage([rawEl({ text: "a".repeat(MAX_TEXT_CHARS) })]), full);
    expect(snap.elements[0]?.text).toHaveLength(MAX_TEXT_CHARS);
    expect(snap.elements[0]?.textTruncated).toBeFalsy();
  });

  it("collapses whitespace in text", () => {
    const snap = buildSample(rawPage([rawEl({ text: "  Only \n\t 2   left  " })]), full);
    expect(snap.elements[0]?.text).toBe("Only 2 left");
  });
});

describe("buildSample: attributes", () => {
  it("keeps the full allowlist and drops everything else", () => {
    const snap = buildSample(
      rawPage([
        rawEl({
          tag: "input",
          attrs: {
            type: "checkbox",
            name: "newsletter",
            disabled: "",
            "aria-label": "Sign up",
            "aria-checked": "true",
            "data-testid": "nl",
            href: "/x",
            for: "nl",
            placeholder: "Email",
            value: "yes",
            onclick: "alert(1)",
            class: "big",
            id: "nl",
            style: "color:red",
          },
        }),
      ]),
      full
    );
    expect(Object.keys(snap.elements[0]?.attributes ?? {}).sort()).toEqual(
      [
        "aria-checked",
        "aria-label",
        "data-testid",
        "disabled",
        "for",
        "href",
        "name",
        "placeholder",
        "type",
        "value",
      ].sort()
    );
  });

  it("keeps only type, name, disabled and data-testid in a light sample", () => {
    const snap = buildSample(
      rawPage([
        rawEl({
          tag: "input",
          attrs: {
            type: "checkbox",
            name: "n",
            disabled: "",
            "data-testid": "t",
            "aria-label": "x",
            href: "/x",
            value: "v",
            placeholder: "p",
            for: "f",
          },
        }),
      ]),
      light
    );
    expect(Object.keys(snap.elements[0]?.attributes ?? {}).sort()).toEqual(["data-testid", "disabled", "name", "type"]);
  });

  it("cuts attribute values at 200 characters", () => {
    const snap = buildSample(rawPage([rawEl({ tag: "a", attrs: { href: "h".repeat(500) } })]), full);
    expect(snap.elements[0]?.attributes?.href).toHaveLength(MAX_ATTR_CHARS);
  });

  it.each(["checkbox", "radio", "submit", "button", "reset"])("keeps value of an input of type %s", (type) => {
    const snap = buildSample(rawPage([rawEl({ tag: "input", attrs: { type, value: "v" } })]), full);
    expect(snap.elements[0]?.attributes?.value).toBe("v");
  });

  it.each(["text", "password", "hidden", "email", "TEXT"])("drops value of an input of type %s", (type) => {
    const snap = buildSample(rawPage([rawEl({ tag: "input", attrs: { type, value: "secret" } })]), full);
    expect(snap.elements[0]?.attributes).not.toHaveProperty("value");
  });

  it("drops value of an input without a type", () => {
    const snap = buildSample(rawPage([rawEl({ tag: "input", attrs: { value: "secret" } })]), full);
    expect(snap.elements[0]?.attributes).not.toHaveProperty("value");
  });

  it("keeps value of a button and an option", () => {
    const snap = buildSample(
      rawPage([
        rawEl({ path: [0], tag: "button", attrs: { value: "go" } }),
        rawEl({ path: [1], tag: "option", attrs: { value: "opt" } }),
      ]),
      full
    );
    expect(snap.elements[0]?.attributes?.value).toBe("go");
    expect(snap.elements[1]?.attributes?.value).toBe("opt");
  });

  it("drops value of other tags", () => {
    const snap = buildSample(
      rawPage([
        rawEl({ path: [0], tag: "textarea", attrs: { value: "typed" } }),
        rawEl({ path: [1], tag: "div", attrs: { value: "x" } }),
        rawEl({ path: [2], tag: "select", attrs: { value: "x" } }),
      ]),
      full
    );
    for (const el of snap.elements) expect(el.attributes).not.toHaveProperty("value");
  });

  it("drops non-string attribute values", () => {
    const attrs = { type: 5, name: "ok" } as unknown as Record<string, string>;
    const snap = buildSample(rawPage([rawEl({ tag: "input", attrs })]), full);
    expect(snap.elements[0]?.attributes).toEqual({ name: "ok" });
  });
});

describe("buildSample: malformed elements", () => {
  it("drops elements without a path, with a non-string tag or without a rect", () => {
    const bad = [
      { ...rawEl({ path: [0] }), path: undefined },
      { ...rawEl({ path: [1] }), tag: 5 },
      { ...rawEl({ path: [2] }), rect: undefined },
      null,
      "text",
    ] as unknown as RawElement[];
    const snap = buildSample(rawPage([...bad, rawEl({ path: [9] })]), full);
    expect(snap.elements.map((e) => e.id)).toEqual(["el-9"]);
  });

  it("drops an element whose path holds a non-index value", () => {
    const bad = rawEl({ path: [1, -1] });
    const worse = rawEl({ path: [1, "x" as unknown as number] });
    const snap = buildSample(rawPage([bad, worse, rawEl({ path: [3] })]), full);
    expect(snap.elements.map((e) => e.id)).toEqual(["el-3"]);
  });

  it("does not count dropped elements as truncation", () => {
    const bad = { ...rawEl({ path: [0] }), tag: 5 } as unknown as RawElement;
    const snap = buildSample(rawPage([bad, rawEl({ path: [1] })], { eligibleCount: 2 }), full);
    expect(snap.elements).toHaveLength(1);
    expect(snap.capture?.elementsTruncated).toBe(false);
  });
});

describe("buildSample: element fields", () => {
  it("copies style, form state and role", () => {
    const snap = buildSample(
      rawPage([
        rawEl({
          role: "button",
          checked: true,
          selected: true,
          style: {
            color: "rgb(1, 2, 3)",
            backgroundColor: "rgb(4, 5, 6)",
            fontSize: "20px",
            opacity: "0.5",
            display: "inline",
            visibility: "hidden",
            position: "fixed",
          },
        }),
      ]),
      full
    );
    expect(snap.elements[0]).toMatchObject({
      tag: "div",
      role: "button",
      color: "rgb(1, 2, 3)",
      backgroundColor: "rgb(4, 5, 6)",
      fontSize: "20px",
      opacity: "0.5",
      display: "inline",
      visibility: "hidden",
      position: "fixed",
      checked: true,
      selected: true,
    });
  });

  it("omits an absent role", () => {
    const snap = buildSample(rawPage([rawEl({ role: null })]), full);
    expect(snap.elements[0]).not.toHaveProperty("role");
  });
});

describe("buildSample: page metrics and capture metadata", () => {
  it("fills viewport and document sizes, url and capturedAt", () => {
    const raw = rawPage([], { innerWidth: 1200, innerHeight: 700, scrollWidth: 1300, scrollHeight: 9_000, devicePixelRatio: 2 });
    const snap = buildSample(raw, full);
    expect(snap).toMatchObject({
      url: URL_,
      capturedAt: CAPTURED_AT,
      viewportWidth: 1200,
      viewportHeight: 700,
      fullWidth: 1300,
      fullHeight: 9_000,
    });
    expect(snap.capture?.devicePixelRatio).toBe(2);
  });

  it("copies the images metadata into capture.images for the first sample", () => {
    const images = {
      mode: "tiled" as const,
      truncated: true,
      items: [
        { offsetY: 0, width: 1280, height: 800 },
        { offsetY: 800, width: 1280, height: 800 },
      ],
    };
    const snap = buildSample(rawPage([rawEl()]), { ...full, images });
    expect(snap.capture?.images).toEqual(images);
  });

  it("leaves capture.images unset when no images are given", () => {
    const snap = buildSample(rawPage([rawEl()]), light);
    expect(snap.capture).not.toHaveProperty("images");
  });

  it("does not set outsideImage in a sample without images", () => {
    const snap = buildSample(rawPage([rawEl({ rect: { left: 0, top: 99_999, width: 10, height: 10 } })]), light);
    expect(snap.elements[0]).not.toHaveProperty("outsideImage");
  });

  it("sets outsideImage from the images of the first sample", () => {
    const images = {
      mode: "single" as const,
      truncated: true,
      items: [{ offsetY: 0, width: 1280, height: 8_000 }],
    };
    const raw = rawPage([
      rawEl({ path: [0], rect: { left: 0, top: 100, width: 10, height: 10 } }),
      rawEl({ path: [1], rect: { left: 0, top: 8_000, width: 10, height: 10 } }),
    ]);
    const snap = buildSample(raw, { ...full, images });
    expect(snap.elements[0]?.outsideImage).toBe(false);
    expect(snap.elements[1]?.outsideImage).toBe(true);
  });

  it("does not flag a box covered only by a second tile", () => {
    const images = {
      mode: "tiled" as const,
      truncated: false,
      items: [
        { offsetY: 0, width: 1280, height: 800 },
        { offsetY: 800, width: 1280, height: 800 },
      ],
    };
    const raw = rawPage([
      rawEl({ path: [0], rect: { left: 0, top: 1_000, width: 10, height: 10 } }),
      rawEl({ path: [1], rect: { left: 0, top: 2_000, width: 10, height: 10 } }),
    ]);
    const snap = buildSample(raw, { ...full, images });
    expect(snap.elements[0]?.outsideImage).toBe(false);
    expect(snap.elements[1]?.outsideImage).toBe(true);
  });

  it("uses document coordinates (scroll included) for the outside test", () => {
    const images = { mode: "single" as const, truncated: false, items: [{ offsetY: 0, width: 1280, height: 1_000 }] };
    const raw = rawPage([rawEl({ rect: { left: 0, top: 10, width: 10, height: 10 } })], { scrollY: 2_000 });
    const snap = buildSample(raw, { ...full, images });
    expect(snap.elements[0]?.outsideImage).toBe(true);
  });
});

describe("buildSample: schema", () => {
  it("produces output that parses with BaseSnapshotSchema", () => {
    const images = { mode: "single" as const, truncated: false, items: [{ offsetY: 0, width: 1280, height: 3_000 }] };
    const raw = rawPage([
      rawEl({ path: [0], tag: "input", attrs: { type: "checkbox", value: "1" }, checked: true }),
      rawEl({ path: [1], role: "button", text: "Buy" }),
    ]);
    expect(BaseSnapshotSchema.safeParse(buildSample(raw, { ...full, images })).success).toBe(true);
    expect(BaseSnapshotSchema.safeParse(buildSample(raw, light)).success).toBe(true);
  });

  it("leaves a zero devicePixelRatio so that validation can reject it", () => {
    const snap = buildSample(rawPage([rawEl()], { devicePixelRatio: 0 }), full);
    expect(snap.capture?.devicePixelRatio).toBe(0);
    expect(BaseSnapshotSchema.safeParse(snap).success).toBe(false);
  });
});

describe("collectInPage", () => {
  it("is self-contained: no transpiler helper, dynamic import or require", () => {
    const source = String(collectInPage);
    expect(source).not.toContain("__name");
    expect(source).not.toContain("import(");
    expect(source).not.toContain("require(");
  });
});
