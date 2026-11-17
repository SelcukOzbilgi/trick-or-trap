import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PatternIdSchema } from "@/lib/types";
import {
  DETECTION_SIGNALS,
  DetectionSignalSchema,
  GROUND_TRUTH_ID_SHAPE,
  GroundTruthEntrySchema,
  GroundTruthSchema,
} from "@/lib/boo-tique/ground-truth";

const ROOT = process.cwd();
const FIXTURE_PATH = join(ROOT, "tests", "fixtures", "boo-tique-ground-truth.json");
const RESEARCH_PATH = join(ROOT, "docs", "research", "boo-tique-ground-truth.json");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const flagEntry = {
  id: "home-hero-countdown-restart",
  page: "home",
  route: "/boo-tique",
  element: "Hero banner",
  pattern: "fake-urgency",
  phase: 1,
  difficulty: "easy",
  expectedVerdict: "flag",
  detectionSignals: ["text"],
  detectionNote: "A note of more than twenty characters.",
};

const noneEntry = {
  id: "home-fixed-date-sale",
  page: "home",
  route: "/boo-tique",
  element: "Fixed date sale",
  pattern: "none",
  phase: 1,
  difficulty: "lookalike",
  expectedVerdict: "no-flag",
  detectionSignals: ["text"],
  detectionNote: "A note of more than twenty characters.",
};

const NOT_SCORED_NOTE = "Not scored: one static snapshot cannot show it.";

describe("GroundTruthEntrySchema", () => {
  it("accepts a valid flag entry", () => {
    expect(GroundTruthEntrySchema.safeParse(flagEntry).success).toBe(true);
  });

  it("accepts a valid none entry", () => {
    expect(GroundTruthEntrySchema.safeParse(noneEntry).success).toBe(true);
  });

  it("accepts a route that keeps a query string", () => {
    const entry = { ...flagEntry, route: "/boo-tique?banner=ghost" };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects pattern none with verdict flag", () => {
    const entry = { ...noneEntry, expectedVerdict: "flag" };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects a canonical pattern id with verdict no-flag", () => {
    const entry = { ...flagEntry, expectedVerdict: "no-flag" };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it.each(["urgency", "scarcity", "activity"])(
    "rejects the research short id %s as a pattern",
    (short) => {
      const entry = { ...flagEntry, pattern: short };
      expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
    },
  );

  it.each([
    "hero-countdown",
    "Home-hero",
    "home",
    "home-Hero",
    "shop-hero-countdown",
    "home_hero_countdown",
  ])("rejects the id %s that does not match the id shape", (id) => {
    expect(GROUND_TRUTH_ID_SHAPE.test(id)).toBe(false);
    expect(GroundTruthEntrySchema.safeParse({ ...flagEntry, id }).success).toBe(false);
  });

  it.each(["/", "/cart", "/?banner=ghost", "boo-tique", "/boo-tiquex"])(
    "rejects the route %s that does not start with /boo-tique",
    (route) => {
      expect(GroundTruthEntrySchema.safeParse({ ...flagEntry, route }).success).toBe(false);
    },
  );

  it("does not list none among the PatternId values", () => {
    expect(PatternIdSchema.options).not.toContain("none");
  });

  it("lists the seven detection signals", () => {
    expect([...DETECTION_SIGNALS]).toEqual([
      "text",
      "attribute",
      "style",
      "reload-variance",
      "timing",
      "cross-page",
      "not-static",
    ]);
    expect(DetectionSignalSchema.safeParse("text").success).toBe(true);
    expect(DetectionSignalSchema.safeParse("magic").success).toBe(false);
  });

  it("rejects an entry without detectionSignals", () => {
    const { detectionSignals: _omitted, ...entry } = flagEntry;
    void _omitted;
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects an entry without detectionNote", () => {
    const { detectionNote: _omitted, ...entry } = flagEntry;
    void _omitted;
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects an empty detectionSignals list", () => {
    const entry = { ...flagEntry, detectionSignals: [] };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects a signal outside the closed set", () => {
    const entry = { ...flagEntry, detectionSignals: ["magic"] };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects a duplicate signal", () => {
    const entry = { ...flagEntry, detectionSignals: ["text", "text"] };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("accepts several different signals", () => {
    const entry = { ...flagEntry, detectionSignals: ["text", "reload-variance"] };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects a note shorter than 20 characters after trimming", () => {
    const entry = { ...flagEntry, detectionNote: "   too short note   " };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects not-static with a note that does not start with Not scored:", () => {
    const entry = { ...flagEntry, detectionSignals: ["not-static"] };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects a Not scored: note with signals other than not-static", () => {
    const entry = { ...flagEntry, detectionNote: NOT_SCORED_NOTE };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects not-static mixed with another signal", () => {
    const entry = {
      ...flagEntry,
      detectionSignals: ["not-static", "text"],
      detectionNote: NOT_SCORED_NOTE,
    };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("accepts not-static alone with a Not scored: note", () => {
    const entry = {
      ...flagEntry,
      detectionSignals: ["not-static"],
      detectionNote: NOT_SCORED_NOTE,
    };
    expect(GroundTruthEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("names the entry id in the not-scored refinement message", () => {
    const entry = { ...flagEntry, detectionSignals: ["not-static"] };
    const result = GroundTruthEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join(" | ");
      expect(messages).toContain(flagEntry.id);
    }
  });
});

describe("GroundTruthSchema", () => {
  it("accepts a list of unique ids", () => {
    expect(GroundTruthSchema.safeParse([flagEntry, noneEntry]).success).toBe(true);
  });

  it("rejects a list with a duplicate id", () => {
    const result = GroundTruthSchema.safeParse([flagEntry, { ...flagEntry }]);
    expect(result.success).toBe(false);
  });
});

describe("boo-tique ground-truth fixture", () => {
  const raw = readJson(FIXTURE_PATH);

  it("parses with GroundTruthSchema", () => {
    const result = GroundTruthSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  const entries = GroundTruthSchema.parse(raw);

  it("has 30 entries, 22 flag and 8 no-flag", () => {
    expect(entries).toHaveLength(30);
    expect(entries.filter((e) => e.expectedVerdict === "flag")).toHaveLength(22);
    expect(entries.filter((e) => e.expectedVerdict === "no-flag")).toHaveLength(8);
  });

  it("uses the pattern none for exactly the 8 no-flag entries", () => {
    const none = entries.filter((e) => e.pattern === "none");
    expect(none).toHaveLength(8);
    expect(none.every((e) => e.expectedVerdict === "no-flag")).toBe(true);
    expect(
      entries.filter((e) => e.expectedVerdict === "no-flag").every((e) => e.pattern === "none"),
    ).toBe(true);
  });

  it("marks exactly the five phase-2 entries with phase 2", () => {
    const phase2 = entries.filter((e) => e.phase === 2).map((e) => e.id);
    expect(phase2.sort()).toEqual(
      [
        "cart-insurance-sneaked",
        "checkout-handling-fees-drip",
        "checkout-consistent-shipping-tax",
        "account-cancel-five-screens",
        "account-one-click-cancel-plan",
      ].sort(),
    );
  });

  it("gives every entry a route that starts with /boo-tique", () => {
    for (const e of entries) {
      expect(e.route.startsWith("/boo-tique"), e.id).toBe(true);
    }
  });

  it("uses canonical pattern ids only", () => {
    for (const e of entries) {
      expect(["urgency", "scarcity", "activity"], e.id).not.toContain(e.pattern);
    }
  });

  it("gives every entry non-empty detection signals and a note of at least 20 characters", () => {
    for (const e of entries) {
      expect(e.detectionSignals.length, e.id).toBeGreaterThan(0);
      expect(e.detectionNote.trim().length, e.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("carries not-static on exactly the three phase-2 flag entries", () => {
    const notStatic = entries.filter((e) => e.detectionSignals.includes("not-static"));
    expect(notStatic.map((e) => e.id).sort()).toEqual(
      [
        "cart-insurance-sneaked",
        "checkout-handling-fees-drip",
        "account-cancel-five-screens",
      ].sort(),
    );
    for (const e of notStatic) {
      expect(e.detectionSignals, e.id).toEqual(["not-static"]);
      expect(e.detectionNote.startsWith("Not scored:"), e.id).toBe(true);
      expect(e.detectionNote, e.id).toContain("boo-tique-flows");
      expect(e.detectionNote, e.id).toMatch(/snapshot/);
    }
  });

  it("keeps the two honest phase-2 entries scored", () => {
    for (const id of ["checkout-consistent-shipping-tax", "account-one-click-cancel-plan"]) {
      const entry = entries.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(entry!.detectionSignals, id).not.toContain("not-static");
      expect(entry!.detectionNote.startsWith("Not scored:"), id).toBe(false);
    }
  });

  function noteOf(id: string): string {
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error(`No fixture entry ${id}`);
    return entry.detectionNote;
  }

  it("records the review caveats in the notes", () => {
    expect(noteOf("home-rolling-midnight-text")).toContain("midnight");
    expect(noteOf("club-timer-session-restart")).toContain("10 minutes");
    expect(noteOf("product-low-stock-random")).toContain("3 samples");
    expect(noteOf("product-low-stock-random")).toContain("never 3");
    expect(noteOf("product-viewers-random")).toContain("3 samples");
    expect(noteOf("product-real-inventory-3-left")).toContain("never equals 3");
  });

  it("gives the selling-fast badge the product-page-only element text", () => {
    const entry = entries.find((e) => e.id === "product-selling-fast-badge");
    expect(entry?.element).toBe("'Selling fast' badge on the product page, no number");
  });
});

// ── Derivation against the research file ───────────────────────────────────

const PATTERN_MAP: Readonly<Record<string, string>> = {
  urgency: "fake-urgency",
  scarcity: "fake-scarcity",
  activity: "fake-activity",
  "fake-urgency": "fake-urgency",
  "fake-scarcity": "fake-scarcity",
  "fake-activity": "fake-activity",
  confirmshaming: "confirmshaming",
  preselection: "preselection",
  "visual-interference": "visual-interference",
  "sneak-into-basket": "sneak-into-basket",
  "drip-pricing": "drip-pricing",
  "hard-to-cancel": "hard-to-cancel",
  none: "none",
};

function mapPattern(research: string): string {
  const mapped = PATTERN_MAP[research];
  if (mapped === undefined) {
    throw new Error(`Unmapped research pattern: ${research}`);
  }
  return mapped;
}

function mapRoute(research: string): string {
  const url = new URL(research, "http://boo-tique.test");
  const path = url.pathname === "/" ? "" : url.pathname;
  return `/boo-tique${path}${url.search}`;
}

type ResearchEntry = {
  id: string;
  page: string;
  route: string;
  element: string;
  pattern: string;
  phase: number;
  difficulty: string;
  expectedVerdict: string;
};

describe("fixture derivation from docs/research", () => {
  const research = readJson(RESEARCH_PATH) as ResearchEntry[];
  const fixture = GroundTruthSchema.parse(readJson(FIXTURE_PATH));

  it("has the same number of entries", () => {
    expect(fixture).toHaveLength(research.length);
  });

  it("lists the same ids in the same order", () => {
    expect(fixture.map((e) => e.id)).toEqual(research.map((e) => e.id));
  });

  it("matches the research file entry by entry", () => {
    research.forEach((r, i) => {
      const f = fixture[i];
      expect(f.id, `entry ${i}`).toBe(r.id);
      expect(f.expectedVerdict, `${r.id} verdict`).toBe(r.expectedVerdict);
      expect(f.phase, `${r.id} phase`).toBe(r.phase);
      expect(f.difficulty, `${r.id} difficulty`).toBe(r.difficulty);
      expect(f.page, `${r.id} page`).toBe(r.page);
      expect(f.element, `${r.id} element`).toBe(r.element);
      expect(f.pattern, `${r.id} pattern`).toBe(mapPattern(r.pattern));
      expect(f.route, `${r.id} route`).toBe(mapRoute(r.route));
    });
  });

  describe("shared fields, keys and drift detection", () => {
    const SHARED_FIELDS = [
      "id",
      "page",
      "route",
      "element",
      "pattern",
      "phase",
      "difficulty",
      "expectedVerdict",
    ] as const;
    const EXTRA_KEYS = ["detectionSignals", "detectionNote"];

    /** Names of the shared fields in which a fixture entry differs from its research entry. */
    function sharedFieldDiffs(r: ResearchEntry, f: Record<string, unknown>): string[] {
      const expected: Record<string, unknown> = {
        ...r,
        pattern: mapPattern(r.pattern),
        route: mapRoute(r.route),
      };
      return SHARED_FIELDS.filter((name) => f[name] !== expected[name]);
    }

    it("gives the research JSON neither detectionSignals nor detectionNote", () => {
      for (const r of research) {
        const keys = Object.keys(r);
        for (const extra of EXTRA_KEYS) expect(keys, `${r.id} ${extra}`).not.toContain(extra);
      }
    });

    it("gives the fixture the research keys plus the two new keys", () => {
      const rawFixture = readJson(FIXTURE_PATH) as Record<string, unknown>[];
      research.forEach((r, i) => {
        const fixtureKeys = Object.keys(rawFixture[i]).filter((k) => !EXTRA_KEYS.includes(k));
        expect(fixtureKeys.sort(), r.id).toEqual(Object.keys(r).sort());
        expect(Object.keys(rawFixture[i]), r.id).toEqual(expect.arrayContaining(EXTRA_KEYS));
      });
    });

    it("finds no difference in the shared fields of the real files", () => {
      research.forEach((r, i) => {
        expect(sharedFieldDiffs(r, fixture[i]), r.id).toEqual([]);
      });
    });

    it("detects a changed element in a mutated copy", () => {
      const mutated = { ...fixture[0], element: `${fixture[0].element} (edited)` };
      expect(sharedFieldDiffs(research[0], mutated)).toEqual(["element"]);
    });

    it("detects a changed phase in a mutated copy", () => {
      const mutated = { ...fixture[0], phase: 2 };
      expect(sharedFieldDiffs(research[0], mutated)).toEqual(["phase"]);
    });

    it("gives the selling-fast element the same text in both files", () => {
      const text = "'Selling fast' badge on the product page, no number";
      const r = research.find((e) => e.id === "product-selling-fast-badge");
      const f = fixture.find((e) => e.id === "product-selling-fast-badge");
      expect(r?.element).toBe(text);
      expect(f?.element).toBe(text);
    });
  });

  describe("mapping helpers", () => {
    it("maps the research short ids to canonical ids", () => {
      expect(mapPattern("urgency")).toBe("fake-urgency");
      expect(mapPattern("scarcity")).toBe("fake-scarcity");
      expect(mapPattern("activity")).toBe("fake-activity");
    });

    it("leaves canonical ids and none unchanged", () => {
      for (const id of PatternIdSchema.options) {
        expect(mapPattern(id)).toBe(id);
      }
      expect(mapPattern("none")).toBe("none");
    });

    it("fails for a research pattern outside the mapping", () => {
      const sample: ResearchEntry[] = [
        {
          id: "home-bogus-entry",
          page: "home",
          route: "/",
          element: "x",
          pattern: "bogus-pattern",
          phase: 1,
          difficulty: "easy",
          expectedVerdict: "flag",
        },
      ];
      expect(() => sample.forEach((r) => mapPattern(r.pattern))).toThrow(/bogus-pattern/);
    });

    it("maps routes by prefixing /boo-tique and dropping a lone /", () => {
      expect(mapRoute("/")).toBe("/boo-tique");
      expect(mapRoute("/?banner=ghost")).toBe("/boo-tique?banner=ghost");
      expect(mapRoute("/?modal=exit-intent")).toBe("/boo-tique?modal=exit-intent");
      expect(mapRoute("/cart")).toBe("/boo-tique/cart");
      expect(mapRoute("/checkout?flow=honest")).toBe("/boo-tique/checkout?flow=honest");
      expect(mapRoute("/product/ghost-pepper-candle")).toBe(
        "/boo-tique/product/ghost-pepper-candle",
      );
    });
  });
});
