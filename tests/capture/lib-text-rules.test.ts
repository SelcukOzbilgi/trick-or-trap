import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_NAME_SAMPLES, TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

/** The word the test-id attribute name ends with, built from parts. */
const WORD = "test" + "id";

const ROOT = process.cwd();
const DIRECTORIES = ["lib/capture", "tests/capture", ".kiro/specs/page-capture", ".kiro/specs/page-capture-fixes"];
const FILES = [".kiro/steering/tech.md", ".kiro/steering/structure.md"];

function listFiles(path: string): string[] {
  const stats = statSync(path);
  if (!stats.isDirectory()) return [path];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    out.push(...listFiles(join(path, entry)));
  }
  return out;
}

describe("forbidden attribute helper", () => {
  it("builds the attribute name from parts", () => {
    expect(TEST_ID_ATTRIBUTE.startsWith("data-")).toBe(true);
    expect(TEST_ID_ATTRIBUTE.toLowerCase().endsWith(WORD)).toBe(true);
  });

  it("lists names that name an outcome", () => {
    expect(FORBIDDEN_NAME_SAMPLES).toEqual(["data-verdict", "data-pattern", "aria-verdict", "aria-pattern-id"]);
  });
});

describe("text rules: the test-id attribute is named nowhere", () => {
  const files = [...DIRECTORIES.flatMap((dir) => listFiles(join(ROOT, dir))), ...FILES.map((f) => join(ROOT, f))];

  it("reads a plausible number of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(DIRECTORIES)("has no file under %s that contains the word", (dir) => {
    const offenders = listFiles(join(ROOT, dir)).filter((file) => readFileSync(file, "utf8").toLowerCase().includes(WORD));
    expect(offenders.map((file) => file.slice(ROOT.length + 1))).toEqual([]);
  });

  it.each(FILES)("has no mention in %s", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8").toLowerCase().includes(WORD)).toBe(false);
  });
});
