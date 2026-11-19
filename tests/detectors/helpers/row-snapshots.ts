import type { PageSnapshot } from "@/lib/types";

/**
 * One small plain-object snapshot per rule row that produces a finding, for
 * the rows of the old criteria 8.18 (U1 to U7), 9.8 (S1 to S5), 10.6 (A1 to
 * A3), 11.9 (C1, C2), 12.14 (P1 to P5) and 13.12 (V1 to V4, with the
 * medium pair row V2). They are built like the `raw()` helpers of the
 * detector tests and use ordinary shop wording. The wording test runs the
 * detectors on them and reads every string of every finding.
 */

type Raw = Record<string, unknown>;

const FIRST_TIME = "2026-12-01T12:00:00.000Z";
const RELOAD_TIME = "2026-12-01T12:00:09.000Z";

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

function sample(capturedAt: string, elements: Raw[], extra: Raw = {}): Raw {
  return {
    url: "https://shop.example/",
    capturedAt,
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    elements,
    ...extra,
  };
}

/** A snapshot of one sample, or of two when `reload` is given (9 s later). */
function snapshot(first: Raw[], reload?: Raw[]): PageSnapshot {
  const extra: Raw = reload === undefined ? {} : { afterReload: sample(RELOAD_TIME, reload) };
  return sample(FIRST_TIME, first, extra) as unknown as PageSnapshot;
}

/** One text element `el-1-0`, with the given text and, optionally, a reload text. */
function text(first: string, reload?: string, over: Raw = {}): PageSnapshot {
  return snapshot(
    [raw("el-1-0", "span", first, over)],
    reload === undefined ? undefined : [raw("el-1-0", "span", reload, over)]
  );
}

/** Accept control first, decline control second, under one parent. */
function offer(decline: string, accept: string): PageSnapshot {
  return snapshot([raw("el-1-0-0", "button", accept), raw("el-1-0-1", "button", decline)]);
}

/** A checkbox row: a label with the text and the ticked input inside it. */
function checkbox(label: string): PageSnapshot {
  return snapshot([
    raw("el-1-0", "label", label, { boundingBox: box(200, 24) }),
    raw("el-1-0-0", "input", "", {
      boundingBox: box(200, 24),
      checked: true,
      attributes: { type: "checkbox" },
    }),
  ]);
}

type Option = { readonly text: string; readonly checked?: boolean };

/** A fieldset with a legend and one label per radio option. */
function radios(legend: string, name: string, options: readonly Option[]): PageSnapshot {
  const rows: Raw[] = [raw("el-1-0-0", "legend", legend, { boundingBox: box(200, 24) })];
  options.forEach((option, i) => {
    rows.push(raw(`el-1-0-${i + 1}`, "label", option.text, { boundingBox: box(200, 24) }));
    rows.push(
      raw(`el-1-0-${i + 1}-0`, "input", "", {
        boundingBox: box(200, 24),
        checked: option.checked === true,
        attributes: { type: "radio", name },
      })
    );
  });
  return snapshot(rows);
}

const BIG_ACCEPT: Raw = {
  fontSize: "20px",
  color: WHITE,
  backgroundColor: BLOOD,
  boundingBox: box(220, 56),
};
const SMALL_LINK: Raw = {
  fontSize: "11px",
  color: "rgb(154, 154, 154)",
  boundingBox: box(40, 14),
};
const FAINT_CLOSE: Raw = {
  fontSize: "8px",
  color: "rgb(207, 198, 188)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  boundingBox: box(3, 8),
};

function consentBanner(): Raw[] {
  return [
    raw("el-1-0", "div", "", {
      role: "region",
      position: "fixed",
      backgroundColor: CREAM,
      boundingBox: box(1280, 120),
      attributes: { "aria-label": "Cookie preferences" },
    }),
    raw("el-1-0-0", "p", "We use cookies to remember your basket."),
  ];
}

function dialogShell(): Raw {
  return raw("el-1-0", "div", "", {
    role: "dialog",
    position: "fixed",
    backgroundColor: WHITE,
    boundingBox: box(500, 400),
    attributes: { "aria-modal": "true" },
  });
}

export const ROW_SNAPSHOTS: ReadonlyArray<{ row: string; snapshot: PageSnapshot }> = [
  // fake-urgency (old criterion 8.18)
  {
    row: "U1",
    snapshot: text(
      "Sale ends in 01:59:58 (until 28 Feb 2030)",
      "Sale ends in 01:59:59 (until 28 Feb 2030)"
    ),
  },
  { row: "U2", snapshot: text("Sale ends in 01:59:58", "Sale ends in 01:59:59") },
  {
    row: "U3",
    snapshot: text("Hurry, offer ends in 04:59:59", "Hurry, offer ends in 04:59:59"),
  },
  { row: "U4", snapshot: text("Next draw 01:59:58", "Next draw 01:59:59") },
  { row: "U5", snapshot: text("Offer ends in 09:59", "Offer ends in 09:50") },
  { row: "U6", snapshot: text("Offer ends at midnight") },
  { row: "U7", snapshot: text("Sale ends 29 Nov 2026") },

  // fake-scarcity (old criterion 9.8)
  { row: "S1", snapshot: text("Only 2 left!", "Only 6 left!") },
  { row: "S2", snapshot: text("3 left in stock", "5 left in stock") },
  { row: "S3", snapshot: text("Only 2 left!", "Only 2 left!") },
  { row: "S4", snapshot: text("Only 25 left") },
  { row: "S5", snapshot: text("Selling fast") },

  // fake-activity (old criterion 10.6)
  {
    row: "A1",
    snapshot: text("14 people are viewing this", "31 people are viewing this"),
  },
  {
    row: "A2",
    snapshot: text("Sarah from Leeds just bought the Blue Dress", undefined, {
      tag: "div",
      role: "status",
    }),
  },
  { row: "A3", snapshot: text("14 people are viewing this") },

  // confirmshaming (old criterion 11.9)
  { row: "C1", snapshot: offer("No, I'll pay full price", "Claim my discount") },
  { row: "C2", snapshot: offer("No, I don't need protection", "Add protection") },

  // preselection (old criterion 12.14)
  { row: "P1", snapshot: checkbox("Add protection +$4.99") },
  { row: "P2", snapshot: checkbox("Send me offers and promotions by email") },
  { row: "P3", snapshot: checkbox("Add extended warranty") },
  {
    row: "P4",
    snapshot: radios("Warranty", "warranty", [
      { text: "None $0.00" },
      { text: "Silver warranty +$5.00" },
      { text: "Gold warranty +$9.00", checked: true },
    ]),
  },
  {
    row: "P5",
    snapshot: radios("Shipping", "shipping", [
      { text: "Standard shipping $4.00" },
      { text: "Express shipping +$9.00", checked: true },
    ]),
  },

  // visual-interference (old criterion 13.12)
  {
    row: "V1",
    snapshot: snapshot([
      ...consentBanner(),
      raw("el-1-0-1-0", "a", "options", SMALL_LINK),
      raw("el-1-0-1-1", "button", "Accept all", BIG_ACCEPT),
    ]),
  },
  {
    row: "V2",
    snapshot: snapshot([
      dialogShell(),
      raw("el-1-0-0", "button", "Accept", {
        color: WHITE,
        backgroundColor: BLOOD,
        boundingBox: box(180, 48),
      }),
      raw("el-1-0-1", "button", "Reject", {
        color: "rgb(0, 0, 0)",
        backgroundColor: "rgb(240, 240, 240)",
        opacity: "0.5",
        boundingBox: box(120, 24),
      }),
    ]),
  },
  {
    row: "V3",
    snapshot: snapshot([
      dialogShell(),
      raw("el-1-0-0", "h2", "Complete the set"),
      raw("el-1-0-1", "button", "Add bundle", {
        fontSize: "20px",
        color: WHITE,
        backgroundColor: BLOOD,
        boundingBox: box(400, 60),
      }),
      raw("el-1-0-2", "button", "x", FAINT_CLOSE),
    ]),
  },
  {
    row: "V4",
    snapshot: snapshot([
      dialogShell(),
      raw("el-1-0-0", "p", "Sale ends soon"),
      raw("el-1-0-1", "button", "×", FAINT_CLOSE),
    ]),
  },
];
