import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PatternIdSchema } from "@/lib/types";
import {
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
};

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
