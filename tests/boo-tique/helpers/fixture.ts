import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GroundTruthSchema,
  type GroundTruth,
  type GroundTruthEntry,
} from "@/lib/boo-tique/ground-truth";

const FIXTURE_PATH = join(
  process.cwd(),
  "tests",
  "fixtures",
  "boo-tique-ground-truth.json",
);

/** Reads and validates the ground-truth fixture. */
export function loadFixture(): GroundTruth {
  return GroundTruthSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
}

/** Distinct fixture routes, in first-seen order. */
export function fixtureRoutes(): string[] {
  return [...new Set(loadFixture().map((entry) => entry.route))];
}

/** Fixture entries planted on exactly this route (query string included). */
export function entriesForRoute(route: string): GroundTruthEntry[] {
  return loadFixture().filter((entry) => entry.route === route);
}
