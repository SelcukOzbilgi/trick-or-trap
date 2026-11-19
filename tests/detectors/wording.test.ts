import { describe, it, expect } from "vitest";
import { runAllDetectors } from "@/lib/detectors/all";
import {
  FORBIDDEN_STEMS,
  FORBIDDEN_WORDS,
} from "@/lib/detectors/data/forbidden-words";
import { isForbiddenToken, normaliseText, quote } from "@/lib/detectors/shared/text";
import { buildHoldoutSnapshot } from "@/tests/detectors/eval/helpers/holdout";
import { HOLDOUT_CASES } from "@/tests/detectors/eval/helpers/holdout-cases";
import { PAGE_VARIANTS, buildVariantSnapshot } from "@/tests/detectors/eval/helpers/pages";
import { ROW_SNAPSHOTS } from "@/tests/detectors/helpers/row-snapshots";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * Wording rules of findings-wording.md (requirements 5.6 to 5.8, 1.5): no
 * string of any finding holds a forbidden word or a word that starts with a
 * forbidden stem, every title starts with "Possible", and quoted page text is
 * masked. Old criterion 3.18 named "every unit test snapshot", which another
 * test file cannot observe; the row snapshots, the harness variants and the
 * pages below replace it.
 */

const FORBIDDEN_SET: ReadonlySet<string> = new Set(
  FORBIDDEN_WORDS.map((word) => normaliseText(word))
);
const STEMS: readonly string[] = FORBIDDEN_STEMS.map((stem) => normaliseText(stem));

function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/** The words of a text after normalisation: runs of letters, split at everything else. */
function wordsOf(text: string): string[] {
  const words: string[] = [];
  let run = "";
  for (const ch of normaliseText(text, text.length)) {
    if (isLetter(ch)) {
      run += ch;
    } else {
      if (run !== "") words.push(run);
      run = "";
    }
  }
  if (run !== "") words.push(run);
  return words;
}

function stringsOf(finding: Finding): string[] {
  return [
    finding.title,
    finding.description,
    finding.explanation,
    finding.evidence.text,
    finding.detectorName,
  ];
}

/** Every banned word found in a finding string, as "where: word". */
function bannedIn(findings: readonly Finding[]): string[] {
  const hits: string[] = [];
  for (const finding of findings) {
    for (const text of stringsOf(finding)) {
      for (const word of wordsOf(text)) {
        if (FORBIDDEN_SET.has(word) || STEMS.some((stem) => word.startsWith(stem))) {
          hits.push(`${finding.title}: "${word}"`);
        }
      }
    }
  }
  return hits;
}

function titlesWithoutPossible(findings: readonly Finding[]): string[] {
  return findings.filter((f) => !f.title.startsWith("Possible")).map((f) => f.title);
}

function runClean(snapshot: PageSnapshot): Finding[] {
  const result = runAllDetectors(snapshot);
  expect(result.errors).toEqual([]);
  return result.findings;
}

// ---------------------------------------------------------------------------
// Pages that quote banned words in each place a detector quotes text
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const FIRST_TIME = "2026-12-01T12:00:00.000Z";
const RELOAD_TIME = "2026-12-01T12:00:09.000Z";
const BLOOD = "rgb(139, 26, 26)";
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

function snapshot(first: Raw[], reload?: Raw[]): PageSnapshot {
  const base = {
    url: "https://shop.example/",
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
  };
  return {
    ...base,
    capturedAt: FIRST_TIME,
    elements: first,
    ...(reload === undefined
      ? {}
      : { afterReload: { ...base, capturedAt: RELOAD_TIME, elements: reload } }),
  } as unknown as PageSnapshot;
}

const BANNED_FORMS: readonly string[] = [
  "scammers",
  "frauds",
  "dolandırıcılara",
  "dolandırıcılık",
  "illegally",
  "yasadışı",
  "aldatıcı",
  "SCAMMERS",
  "DOLANDIRICILARA",
  "Yasadışı'nın",
  "scam's",
];

/** Pages where `word` sits in a claim, a decline control, a label and an action beside a close control. */
function quotingPages(word: string): ReadonlyArray<{ place: string; page: PageSnapshot }> {
  const one = (first: string, reload?: string): PageSnapshot =>
    snapshot([raw("el-1-0", "span", first)], reload === undefined ? undefined : [raw("el-1-0", "span", reload)]);
  return [
    { place: "urgency claim", page: one(`Sale ends in 01:59:58 ${word}`, `Sale ends in 01:59:59 ${word}`) },
    { place: "scarcity claim", page: one(`Only 2 left! ${word}`, `Only 6 left! ${word}`) },
    { place: "activity claim", page: one(`14 people are viewing this ${word}`, `31 people are viewing this ${word}`) },
    {
      place: "decline control",
      page: snapshot([
        raw("el-1-0-0", "button", `Claim my discount ${word}`),
        raw("el-1-0-1", "button", `No, I'll pay full price ${word}`),
      ]),
    },
    {
      place: "option label",
      page: snapshot([
        raw("el-1-0", "label", `Add protection +$4.99 ${word}`, { boundingBox: box(200, 24) }),
        raw("el-1-0-0", "input", "", {
          boundingBox: box(200, 24),
          checked: true,
          attributes: { type: "checkbox" },
        }),
      ]),
    },
    {
      place: "action next to a close control",
      page: snapshot([
        raw("el-1-0", "div", "", {
          role: "dialog",
          position: "fixed",
          backgroundColor: WHITE,
          boundingBox: box(500, 400),
          attributes: { "aria-modal": "true" },
        }),
        raw("el-1-0-1", "button", `Add bundle ${word}`, {
          fontSize: "20px",
          color: WHITE,
          backgroundColor: BLOOD,
          boundingBox: box(400, 60),
        }),
        // A close control is found by an exact word or glyph, so only the dominant action can quote a word.
        raw("el-1-0-2", "button", "x", {
          fontSize: "8px",
          color: "rgb(207, 198, 188)",
          boundingBox: box(3, 8),
        }),
      ]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wording: the rule row snapshots", () => {
  it("cover every row of the six detectors", () => {
    expect(ROW_SNAPSHOTS.map((item) => item.row)).toEqual([
      "U1", "U2", "U3", "U4", "U5", "U6", "U7",
      "S1", "S2", "S3", "S4", "S5",
      "A1", "A2", "A3",
      "C1", "C2",
      "P1", "P2", "P3", "P4", "P5",
      "V1", "V2", "V3", "V4",
    ]);
  });

  it.each(ROW_SNAPSHOTS.map((item) => [item.row, item.snapshot] as const))(
    "row %s gives a finding with a Possible title and no banned word",
    (row, page) => {
      const findings = runClean(page);
      expect(findings.length, `row ${row} gives a finding`).toBeGreaterThan(0);
      expect(titlesWithoutPossible(findings)).toEqual([]);
      expect(bannedIn(findings)).toEqual([]);
    }
  );
});

describe("wording: the harness page variants", () => {
  it.each(PAGE_VARIANTS.map((page) => [page.id, page] as const))(
    "variant %s has Possible titles and no banned word",
    (_id, page) => {
      const findings = runClean(buildVariantSnapshot(page).snapshot);
      expect(titlesWithoutPossible(findings)).toEqual([]);
      expect(bannedIn(findings)).toEqual([]);
    }
  );
});

describe("wording: the hold-out cases (requirement 4, 5.6)", () => {
  it.each(HOLDOUT_CASES.map((c) => [c.id, c] as const))(
    "case %s has Possible titles and no banned word",
    (_id, c) => {
      const findings = runClean(buildHoldoutSnapshot(c).snapshot);
      expect(titlesWithoutPossible(findings)).toEqual([]);
      expect(bannedIn(findings)).toEqual([]);
    }
  );
});

describe("wording: pages that quote banned words", () => {
  for (const word of BANNED_FORMS) {
    for (const { place, page } of quotingPages(word)) {
      it(`masks "${word}" in the ${place}`, () => {
        const findings = runClean(page);
        expect(findings.length, "the page gives a finding").toBeGreaterThan(0);
        expect(titlesWithoutPossible(findings)).toEqual([]);
        expect(bannedIn(findings)).toEqual([]);
      });
    }
  }

  it("shows the mask where the page text was quoted", () => {
    const [claim] = quotingPages("scammers");
    const findings = runClean(claim.page);
    expect(findings.some((f) => f.evidence.text.includes("[word omitted]"))).toBe(true);
  });
});

describe("wording: masking by stem", () => {
  it.each([
    "scammers",
    "frauds",
    "dolandırıcılara",
    "dolandırıcılık",
    "illegally",
    "yasadışı",
    "aldatıcı",
  ])("quote masks %s, after an apostrophe and in capitals", (word) => {
    expect(quote(word)).toBe('"[word omitted]"');
    expect(quote(`${word}'s`)).toBe('"[word omitted]"');
    expect(quote(`${word}'dan`)).toBe('"[word omitted]"');
    expect(quote(word.toUpperCase())).toBe('"[word omitted]"');
  });

  it("isForbiddenToken matches every entry of FORBIDDEN_WORDS", () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(isForbiddenToken(normaliseText(word)), word).toBe(true);
    }
  });

  it("isForbiddenToken matches the stems and nothing about an ordinary word", () => {
    for (const stem of FORBIDDEN_STEMS) {
      expect(isForbiddenToken(normaliseText(stem)), stem).toBe(true);
    }
    for (const ordinary of ["price", "lies", "cart", "indirim", "sepet"]) {
      expect(isForbiddenToken(ordinary), ordinary).toBe(false);
    }
  });
});
