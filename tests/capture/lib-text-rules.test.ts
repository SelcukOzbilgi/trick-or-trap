import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_NAME_SAMPLES, TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

/** The word the test-id attribute name ends with, built from parts. */
const WORD = "test" + "id";

const ROOT = process.cwd();
const DIRECTORIES = [
  "lib/capture",
  "lib/capture-fixture",
  "app/capture-fixture",
  "tests/capture",
  ".kiro/specs/page-capture",
  ".kiro/specs/page-capture-fixes",
  ".kiro/specs/page-capture-fixes-2",
];
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

describe("steering notes match the capture code", () => {
  const structure = readFileSync(join(ROOT, ".kiro/steering/structure.md"), "utf8");
  const tech = readFileSync(join(ROOT, ".kiro/steering/tech.md"), "utf8");

  it.each(readdirSync(join(ROOT, "lib/capture")))("structure.md lists lib/capture/%s", (file) => {
    expect(structure).toContain(file);
  });

  it("structure.md lists the fixture directories and drops the deleted guard", () => {
    expect(structure).toContain("lib/capture-fixture");
    expect(structure).toMatch(/capture-fixture\/\s+# test-only routes/);
    expect(structure).toMatch(/capture-fixture\/\n.*pages\.ts/);
    expect(structure).not.toContain("request-guard");
    expect(structure).not.toContain("page.evaluate");
  });

  it.each(["fake-guard-browser.ts", "browser-guard.test.ts", "response-hardening.test.ts", "outcome.test.ts"])(
    "structure.md lists %s",
    (name) => {
      expect(structure).toContain(name);
    },
  );

  it.each([
    "browser-level",
    "guard-lost",
    "GUARD_HEARTBEAT_INTERVAL_MS",
    "service-worker-blocked",
    "CAPTURE_WEBSOCKET_HARDENING",
    "CAPTURE_FIXTURE_ROUTES",
    "LIVE_FIXTURE_BASE_URL",
    "LIVE_FIXTURE_ALT_BASE_URL",
    "WebTransport",
    "DNS rebinding",
    "customProxy",
  ])("tech.md mentions %s", (text) => {
    expect(tech).toContain(text);
  });

  it("tech.md no longer describes the child-target design or the service-worker bypass", () => {
    expect(tech).not.toContain("Service workers are bypassed");
    expect(tech).not.toContain("puts the same guard on child targets");
    expect(tech).not.toContain("also sets the allowed origin");
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
