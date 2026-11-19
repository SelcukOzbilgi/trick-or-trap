import { describe, it, expect } from "vitest";
import { detectVisualInterference } from "@/lib/detectors/visual-interference";
import { containsForbidden, TITLES } from "@/lib/detectors/shared/finding";
import { FindingSchema } from "@/lib/types";
import type { Finding, PageSnapshot } from "@/lib/types";

type Raw = Record<string, unknown>;

const FIRST_TIME = "2026-12-01T12:00:00.000Z";
const BLOOD = "rgb(139, 26, 26)";
const CREAM = "rgb(255, 249, 238)";
const WHITE = "rgb(255, 255, 255)";

function box(width: number, height: number): Raw {
  return { x: 0, y: 0, width, height };
}

function raw(id: string, tag: string, text: string, over: Raw = {}): Raw {
  return {
    id,
    tag,
    text,
    boundingBox: box(140, 36),
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

function snap(elements: unknown, extra: Raw = {}): PageSnapshot {
  return {
    url: "https://shop.example/",
    capturedAt: FIRST_TIME,
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    elements,
    ...extra,
  } as unknown as PageSnapshot;
}

function only(findings: Finding[]): Finding {
  expect(findings).toHaveLength(1);
  return findings[0];
}

const TITLE_PAIR = TITLES["visual-interference"][0];
const TITLE_CLOSE = TITLES["visual-interference"][1];
const DESCRIPTION_PAIR = "Two choices in the same area differ a lot in size, colour or form.";
const DESCRIPTION_CLOSE =
  "A dialog's close control is very small or faint next to a much larger action.";

// Styles of generic shop controls (a big filled button, a small grey link).
const BIG_ACCEPT: Raw = {
  fontSize: "20px",
  color: WHITE,
  backgroundColor: BLOOD,
  boundingBox: box(220, 56), // area 12,320
};
const SMALL_LINK: Raw = {
  fontSize: "11px",
  color: "rgb(154, 154, 154)",
  boundingBox: box(40, 14), // area 560
};

/** A cookie banner shell: a fixed region on a cream background with one line of text. */
function banner(text = "We use cookies to remember your basket.", label = "Cookie preferences"): Raw[] {
  return [
    raw("el-1-0", "div", "", {
      role: "region",
      position: "fixed",
      backgroundColor: CREAM,
      boundingBox: box(1280, 120),
      attributes: { "aria-label": label },
    }),
    raw("el-1-0-0", "p", text),
  ];
}

/** A dialog shell with an opaque white panel (or the given background). */
function dialog(background = WHITE): Raw {
  return raw("el-1-0", "div", "", {
    role: "dialog",
    position: "fixed",
    backgroundColor: background,
    boundingBox: box(500, 400),
    attributes: { "aria-modal": "true" },
  });
}

const DEFAULT_BANNER = [
  ...banner(),
  raw("el-1-0-1-0", "a", "options", SMALL_LINK),
  raw("el-1-0-1-1", "button", "Accept all", BIG_ACCEPT),
];

describe("visual-interference: pairs", () => {
  it("V1: a large filled accept button next to a small grey link in a cookie region", () => {
    const f = only(detectVisualInterference(snap(DEFAULT_BANNER)));
    expect(f.patternId).toBe("visual-interference");
    expect(f.detectorName).toBe("visual-interference");
    expect(f.title).toBe(TITLE_PAIR);
    expect(f.title.startsWith("Possible")).toBe(true);
    expect(f.confidence).toBe("high");
    expect(f.description).toBe(DESCRIPTION_PAIR);
    expect(f.elementIds).toEqual(["el-1-0-1-0", "el-1-0-1-1"]);
    expect(f.boundingBoxes).toHaveLength(2);
    expect(f.evidence.text).toContain('"Accept all"');
    expect(f.evidence.text).toContain('"options"');
    expect(f.evidence.text).toContain("area ratio 22");
    expect(f.detectedAt).toBe(FIRST_TIME);
    expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("uses the measured-value keys of the design", () => {
    const f = only(detectVisualInterference(snap(DEFAULT_BANNER)));
    expect(f.evidence.measuredValues).toMatchObject({
      areaRatio: 22,
      fontRatio: 1.82,
      declineFontPx: 11,
      declineContrast: 2.7,
      acceptFilled: 1,
      declineFilled: 0,
      declineIsLink: 1,
      noRejectControl: 1,
    });
    expect(f.evidence.measuredValues?.acceptContrast).toBeGreaterThanOrEqual(4.5);
    expect(f.evidence.measuredValues?.backgroundAssumed).toBeUndefined();
  });

  it("V1: a faded ghost reject button in a consent area", () => {
    const f = only(
      detectVisualInterference(
        snap([
          ...banner(),
          raw("el-1-0-1-0", "button", "Accept all", BIG_ACCEPT),
          raw("el-1-0-1-1", "button", "Reject", {
            fontSize: "14px",
            color: "rgb(179, 179, 179)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            opacity: "0.6",
            boundingBox: box(90, 36),
          }),
        ])
      )
    );
    expect(f.confidence).toBe("high");
    expect(f.elementIds).toEqual(["el-1-0-1-1", "el-1-0-1-0"]);
    expect(f.evidence.measuredValues).toMatchObject({ declineOpacity: 0.6, acceptFilled: 1 });
    expect(f.evidence.measuredValues?.declineContrast).toBeLessThan(3);
    expect(f.evidence.measuredValues?.noRejectControl).toBeUndefined();
  });

  it("V1: a Turkish cookie banner", () => {
    const f = only(
      detectVisualInterference(
        snap([
          ...banner("Sitemizde çerezler kullanıyoruz.", "Çerez tercihleri"),
          raw("el-1-0-1-0", "a", "Ayarlar", SMALL_LINK),
          raw("el-1-0-1-1", "button", "Tümünü kabul et", BIG_ACCEPT),
        ])
      )
    );
    expect(f.confidence).toBe("high");
    expect(f.elementIds).toEqual(["el-1-0-1-0", "el-1-0-1-1"]);
  });

  it("V1: a small plain decline link in a dialog", () => {
    const findings = detectVisualInterference(
      snap([
        dialog(),
        raw("el-1-0-0", "button", "Yes, add it", BIG_ACCEPT),
        raw("el-1-0-1", "a", "No thanks", SMALL_LINK),
      ])
    );
    expect(only(findings).confidence).toBe("high");
  });

  it("V2: exactly two measures give medium", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-0", "button", "Accept", {
            color: WHITE,
            backgroundColor: BLOOD,
            boundingBox: box(180, 48), // 8,640
          }),
          raw("el-1-0-1", "button", "Reject", {
            color: "rgb(0, 0, 0)",
            backgroundColor: "rgb(240, 240, 240)",
            opacity: "0.5",
            boundingBox: box(120, 24), // 2,880
          }),
        ])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(f.title).toBe(TITLE_PAIR);
    expect(Object.keys(f.evidence.measuredValues ?? {}).sort()).toEqual([
      "areaRatio",
      "declineOpacity",
    ]);
    expect(f.evidence.measuredValues).toMatchObject({ areaRatio: 3, declineOpacity: 0.5 });
  });

  it("three measures of one class give medium, not high", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-0", "button", "Accept", {
            fontSize: "20px",
            color: WHITE,
            backgroundColor: BLOOD,
            boundingBox: box(180, 48),
          }),
          raw("el-1-0-1", "button", "Reject", {
            fontSize: "11px",
            color: "rgb(0, 0, 0)",
            backgroundColor: "rgb(240, 240, 240)",
            boundingBox: box(80, 20),
          }),
        ])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(Object.keys(f.evidence.measuredValues ?? {}).sort()).toEqual([
      "areaRatio",
      "declineFontPx",
      "fontRatio",
    ]);
  });

  it("one measure never flags", () => {
    const findings = detectVisualInterference(
      snap([
        dialog(),
        raw("el-1-0-0", "button", "Accept", {
          color: WHITE,
          backgroundColor: BLOOD,
          boundingBox: box(180, 48),
        }),
        raw("el-1-0-1", "button", "Reject", {
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgb(240, 240, 240)",
          boundingBox: box(120, 24),
        }),
      ])
    );
    expect(findings).toEqual([]);
  });

  it("an assumed background cannot give high", () => {
    const pair = (background: string): PageSnapshot =>
      snap([
        dialog(background),
        raw("el-1-0-0", "button", "Accept", {
          color: WHITE,
          backgroundColor: BLOOD,
          boundingBox: box(360, 48), // 17,280
        }),
        raw("el-1-0-1", "button", "Reject", {
          color: "rgb(154, 154, 154)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          boundingBox: box(120, 24), // 2,880
        }),
      ]);

    const assumed = only(detectVisualInterference(pair("rgba(0, 0, 0, 0)")));
    expect(assumed.confidence).toBe("medium");
    expect(assumed.evidence.measuredValues).toMatchObject({ backgroundAssumed: 1 });
    expect(assumed.evidence.measuredValues?.declineContrast).toBeLessThan(3);

    const known = only(detectVisualInterference(pair(WHITE)));
    expect(known.confidence).toBe("high");
    expect(known.evidence.measuredValues?.backgroundAssumed).toBeUndefined();
  });

  it("equal style never flags, also with different wording", () => {
    const equal: Raw = {
      fontSize: "16px",
      color: WHITE,
      backgroundColor: BLOOD,
      boundingBox: box(200, 48),
    };
    for (const [accept, decline] of [
      ["Accept all", "Reject all"],
      ["Yes", "Decline"],
      ["Tümünü kabul et", "Tümünü reddet"],
    ]) {
      const findings = detectVisualInterference(
        snap([
          ...banner(),
          raw("el-1-0-1-0", "button", accept, equal),
          raw("el-1-0-1-1", "button", decline, equal),
        ])
      );
      expect(findings, `${accept} / ${decline}`).toEqual([]);
    }
  });

  it("equal style with a small area difference never flags", () => {
    const style: Raw = { fontSize: "16px", color: WHITE, backgroundColor: BLOOD };
    const findings = detectVisualInterference(
      snap([
        ...banner(),
        raw("el-1-0-1-0", "button", "Accept all", { ...style, boundingBox: box(200, 48) }),
        raw("el-1-0-1-1", "button", "Reject all", { ...style, boundingBox: box(200, 40) }),
      ])
    );
    expect(findings).toEqual([]);
  });

  it("a pair outside any context never flags", () => {
    const findings = detectVisualInterference(
      snap([
        raw("el-1-0-0", "a", "options", SMALL_LINK),
        raw("el-1-0-1", "button", "Accept all", BIG_ACCEPT),
      ])
    );
    expect(findings).toEqual([]);
  });

  it("a fixed container makes a pair count as in context", () => {
    const findings = detectVisualInterference(
      snap([
        raw("el-1-0", "div", "Welcome back", {
          position: "sticky",
          backgroundColor: CREAM,
          boundingBox: box(600, 100),
        }),
        raw("el-1-0-0", "a", "options", SMALL_LINK),
        raw("el-1-0-1", "button", "Accept all", BIG_ACCEPT),
      ])
    );
    expect(only(findings).confidence).toBe("high");
  });

  it("reports the strongest pair of a group once", () => {
    const f = only(
      detectVisualInterference(
        snap([
          ...banner(),
          raw("el-1-0-1-0", "a", "options", SMALL_LINK),
          raw("el-1-0-1-1", "button", "Accept all", BIG_ACCEPT),
          raw("el-1-0-1-2", "button", "Reject all", BIG_ACCEPT),
        ])
      )
    );
    expect(f.elementIds).toEqual(["el-1-0-1-0", "el-1-0-1-1"]);
  });

  it("ignores a hidden decline control", () => {
    const findings = detectVisualInterference(
      snap([
        ...banner(),
        raw("el-1-0-1-0", "a", "options", { ...SMALL_LINK, display: "none" }),
        raw("el-1-0-1-1", "button", "Accept all", BIG_ACCEPT),
      ])
    );
    expect(findings).toEqual([]);
  });
});

describe("visual-interference: close controls", () => {
  const ACCEPT_BUNDLE = raw("el-1-0-1", "button", "Add bundle", {
    fontSize: "20px",
    color: WHITE,
    backgroundColor: BLOOD,
    boundingBox: box(400, 60), // 24,000
  });
  const FAINT_CLOSE: Raw = {
    fontSize: "8px",
    color: "rgb(207, 198, 188)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    boundingBox: box(3, 8), // 24
  };

  it("V3: a 3 × 8 px faint x in a dialog with a large accept", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-0", "h2", "Complete the set"),
          ACCEPT_BUNDLE,
          raw("el-1-0-2", "button", "x", FAINT_CLOSE),
        ])
      )
    );
    expect(f.title).toBe(TITLE_CLOSE);
    expect(f.title.startsWith("Possible")).toBe(true);
    expect(f.confidence).toBe("high");
    expect(f.description).toBe(DESCRIPTION_CLOSE);
    expect(f.elementIds).toEqual(["el-1-0-2", "el-1-0-1"]);
    expect(f.evidence.measuredValues).toMatchObject({
      closeWidthPx: 3,
      closeHeightPx: 8,
      dominantAreaRatio: 1000,
    });
    expect(f.evidence.measuredValues?.closeContrast).toBeLessThan(3);
    expect(f.evidence.measuredValues?.backgroundAssumed).toBeUndefined();
    expect(f.evidence.text).toContain('"x"');
    expect(f.evidence.text).toContain("3 × 8 px");
    expect(f.evidence.text).toContain('"Add bundle"');
    expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("V4: two close measures give medium", () => {
    // Tiny and faint, and no accept control in the dialog.
    const f = only(
      detectVisualInterference(
        snap([dialog(), raw("el-1-0-0", "p", "Sale ends soon"), raw("el-1-0-1", "button", "×", FAINT_CLOSE)])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(f.title).toBe(TITLE_CLOSE);
    expect(f.elementIds).toEqual(["el-1-0-1"]);
  });

  it("V4: a faint close on an assumed background is capped at medium", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog("rgba(0, 0, 0, 0)"),
          ACCEPT_BUNDLE,
          raw("el-1-0-2", "button", "✕", FAINT_CLOSE),
        ])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(f.evidence.measuredValues).toMatchObject({ backgroundAssumed: 1 });
  });

  it("V4: a German dialog with a tiny faint × and no accept word", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-0", "p", "Nur noch heute: 20 % Rabatt"),
          raw("el-1-0-1", "button", "Weiter", { boundingBox: box(120, 40) }),
          raw("el-1-0-2", "button", "×", FAINT_CLOSE),
        ])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(f.elementIds).toEqual(["el-1-0-2"]);
  });

  it("finds a close control by its aria-label when it has no text", () => {
    const f = only(
      detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-0", "p", "Sale ends soon"),
          raw("el-1-0-1", "button", "", { ...FAINT_CLOSE, attributes: { "aria-label": "Close" } }),
        ])
      )
    );
    expect(f.confidence).toBe("medium");
    expect(f.evidence.text).toContain('"Close"');
  });

  it("a dialog marked only by role is enough", () => {
    const findings = detectVisualInterference(
      snap([
        raw("el-1-0", "div", "", { role: "alertdialog", backgroundColor: WHITE, boundingBox: box(400, 300) }),
        raw("el-1-0-0", "p", "Sale ends soon"),
        raw("el-1-0-1", "button", "×", FAINT_CLOSE),
      ])
    );
    expect(only(findings).confidence).toBe("medium");
  });

  it("a toast dismiss × in role=status is not a close control", () => {
    const findings = detectVisualInterference(
      snap([
        raw("el-1-0", "div", "Added to cart", {
          role: "status",
          position: "fixed",
          backgroundColor: WHITE,
          boundingBox: box(300, 60),
        }),
        raw("el-1-0-0", "button", "×", FAINT_CLOSE),
      ])
    );
    expect(findings).toEqual([]);
  });

  it("a tiny faint × outside any dialog is not flagged", () => {
    const findings = detectVisualInterference(
      snap([
        raw("el-1-0", "div", "Sale ends soon", { backgroundColor: WHITE, boundingBox: box(300, 60) }),
        raw("el-1-0-0", "button", "×", FAINT_CLOSE),
      ])
    );
    expect(findings).toEqual([]);
  });

  it("one close measure never flags", () => {
    const tinyOnly = detectVisualInterference(
      snap([
        dialog(),
        raw("el-1-0-0", "p", "Sale ends soon"),
        raw("el-1-0-1", "button", "×", { ...FAINT_CLOSE, color: "rgb(0, 0, 0)" }),
      ])
    );
    expect(tinyOnly).toEqual([]);

    const faintOnly = detectVisualInterference(
      snap([
        dialog(),
        raw("el-1-0-0", "p", "Sale ends soon"),
        raw("el-1-0-1", "button", "×", { ...FAINT_CLOSE, boundingBox: box(40, 40) }),
      ])
    );
    expect(faintOnly).toEqual([]);
  });
});

describe("visual-interference: shared contract", () => {
  it("returns [] for an empty snapshot and for non-object input", () => {
    expect(detectVisualInterference(snap([]))).toEqual([]);
    for (const value of [null, undefined, "text", 42, [], {}, { elements: null }, { elements: "x" }]) {
      expect(detectVisualInterference(value as unknown as PageSnapshot)).toEqual([]);
    }
  });

  it("skips elements that are not objects and values that are not numbers", () => {
    const elements = [
      null,
      "text",
      7,
      raw("el-1-0-0", "a", "options", { ...SMALL_LINK, boundingBox: { x: NaN, y: 0, width: Infinity, height: -1 } }),
      raw("el-1-0-1", "button", "Accept all", { ...BIG_ACCEPT, fontSize: 20, color: 5 }),
    ];
    expect(() => detectVisualInterference(snap(elements))).not.toThrow();
    expect(Array.isArray(detectVisualInterference(snap(elements)))).toBe(true);
  });

  it("gives deep-equal results on two calls and ignores the reload sample", () => {
    const snapshot = snap(DEFAULT_BANNER);
    const first = detectVisualInterference(snapshot);
    const other = detectVisualInterference(snap(DEFAULT_BANNER, { afterReload: { elements: [] } }));
    expect(detectVisualInterference(snapshot)).toEqual(first);
    expect(other).toEqual(first);
  });

  it("builds findings that pass the schema and carry no forbidden word", () => {
    const findings = [
      ...detectVisualInterference(snap(DEFAULT_BANNER)),
      ...detectVisualInterference(
        snap([
          dialog(),
          raw("el-1-0-1", "button", "Add bundle", BIG_ACCEPT),
          raw("el-1-0-2", "button", "x", { fontSize: "8px", color: "rgb(207, 198, 188)", boundingBox: box(3, 8) }),
        ])
      ),
    ];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(FindingSchema.safeParse(f).success).toBe(true);
      expect(f.title.startsWith("Possible")).toBe(true);
      for (const text of [f.title, f.description, f.explanation, f.evidence.text]) {
        expect(containsForbidden(text)).toBe(false);
      }
    }
  });

  it("marks an unknown capture time", () => {
    const f = only(detectVisualInterference(snap(DEFAULT_BANNER, { capturedAt: "yesterday" })));
    expect(f.detectedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(f.evidence.measuredValues).toMatchObject({ captureTimeUnknown: 1 });
  });

  it("adds the outside-screenshot sentence", () => {
    const elements = DEFAULT_BANNER.map((e) =>
      e.id === "el-1-0-1-1" ? { ...e, outsideImage: true } : e
    );
    const f = only(detectVisualInterference(snap(elements)));
    expect(f.description).toContain("The element lies outside the screenshot.");
  });

  it("quotes at most 120 characters of a long control text", () => {
    const f = only(
      detectVisualInterference(
        snap([
          ...banner(),
          raw("el-1-0-1-0", "a", "options", SMALL_LINK),
          raw("el-1-0-1-1", "button", `Accept all ${"x".repeat(5000)}`, BIG_ACCEPT),
        ])
      )
    );
    expect(f.evidence.text.length).toBeLessThan(400);
  });
});
