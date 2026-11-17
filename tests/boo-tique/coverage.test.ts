import { describe, it, expect } from "vitest";
import { PatternIdSchema } from "@/lib/types";
import { GROUND_TRUTH_ID_SHAPE } from "@/lib/boo-tique/ground-truth";
import { DEMO_NOTICE_TEXT } from "@/lib/boo-tique/content";
import { entriesForRoute, fixtureRoutes, loadFixture } from "./helpers/fixture";
import { PENDING_ROUTES } from "./helpers/pending-routes";
import { ROUTE_TABLE } from "./helpers/route-table";
import { matchRoutePattern, renderRoute } from "./helpers/render-route";
import { countTestId, testIds } from "./helpers/markup";

const BASE_URL = "http://boo-tique.test";
const ALL_ROUTES = fixtureRoutes();
const FIXTURE_IDS = loadFixture().map((entry) => entry.id);
const FORBIDDEN_STRINGS = [
  ...PatternIdSchema.options,
  "data-pattern",
  "data-verdict",
  "no-flag",
  "lookalike",
];

function pathnameOf(route: string): string {
  return new URL(route, BASE_URL).pathname;
}

function tableCovers(route: string): boolean {
  const pathname = pathnameOf(route);
  return ROUTE_TABLE.some((entry) => matchRoutePattern(entry.pattern, pathname) !== null);
}

const PENDING = new Set(PENDING_ROUTES);
const READY_ROUTES = ALL_ROUTES.filter((route) => !PENDING.has(route));

describe("route completeness guards", () => {
  it("finds the 11 distinct fixture routes", () => {
    expect(ALL_ROUTES).toHaveLength(11);
  });

  it("lists no route twice in PENDING_ROUTES", () => {
    expect(PENDING.size).toBe(PENDING_ROUTES.length);
  });

  it("lists only fixture routes in PENDING_ROUTES", () => {
    for (const route of PENDING_ROUTES) {
      expect(ALL_ROUTES, route).toContain(route);
    }
  });

  // A page path can serve several fixture routes (`/boo-tique` serves four). The page's load
  // line is added once, while the variant routes are removed from PENDING_ROUTES one task at a
  // time, so a pending route may already have a matching table entry. What must never happen
  // is a route that is neither pending nor covered by the table.
  it("puts every fixture route in PENDING_ROUTES or covers it with a route-table entry", () => {
    for (const route of ALL_ROUTES) {
      expect(PENDING.has(route) || tableCovers(route), route).toBe(true);
    }
  });

  it("covers every route that is not pending with a route-table entry", () => {
    for (const route of READY_ROUTES) {
      expect(tableCovers(route), route).toBe(true);
    }
  });

  it("has an empty PENDING_ROUTES", () => {
    expect(PENDING_ROUTES).toEqual([]);
  });

  it("has a route-table entry for every distinct fixture route", () => {
    for (const route of ALL_ROUTES) {
      expect(tableCovers(route), route).toBe(true);
    }
  });

  it("matches every ROUTE_TABLE pattern to at least one fixture route", () => {
    for (const entry of ROUTE_TABLE) {
      const matched = ALL_ROUTES.some(
        (route) => matchRoutePattern(entry.pattern, pathnameOf(route)) !== null,
      );
      expect(matched, entry.pattern).toBe(true);
    }
  });
});

describe.each(READY_ROUTES)("coverage of %s", (route) => {
  const entries = entriesForRoute(route);

  it("has exactly one element per fixture entry planted on this route", async () => {
    const markup = await renderRoute(route);
    for (const entry of entries) {
      expect(countTestId(markup, entry.id), entry.id).toBe(1);
    }
  });

  it("has no entry id that belongs to another route", async () => {
    const markup = await renderRoute(route);
    const own = new Set(entries.map((entry) => entry.id));
    for (const entry of loadFixture()) {
      if (!own.has(entry.id)) {
        expect(countTestId(markup, entry.id), entry.id).toBe(0);
      }
    }
  });

  it("has no entry-shaped test id that is missing from the fixture", async () => {
    const markup = await renderRoute(route);
    for (const id of testIds(markup)) {
      if (GROUND_TRUTH_ID_SHAPE.test(id)) {
        expect(FIXTURE_IDS, id).toContain(id);
      }
    }
  });

  it("starts every other test id with bt-", async () => {
    const markup = await renderRoute(route);
    for (const id of testIds(markup)) {
      if (!FIXTURE_IDS.includes(id)) {
        expect(id.startsWith("bt-"), id).toBe(true);
      }
    }
  });

  it("carries no pattern id, verdict or look-alike wording", async () => {
    const markup = await renderRoute(route);
    for (const word of FORBIDDEN_STRINGS) {
      expect(markup, word).not.toContain(word);
    }
  });

  it("keeps the demo notice out of the raw page output", async () => {
    const raw = await renderRoute(route, { shell: false });
    expect(raw).not.toContain(DEMO_NOTICE_TEXT);
    expect(raw).not.toContain("bt-demo-notice");
  });
});
