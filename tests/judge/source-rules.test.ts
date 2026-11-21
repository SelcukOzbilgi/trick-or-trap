import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source rules of the model judge (requirements 1.1, 1.3, 1.4, 1.16, 15.1 to
 * 15.8). These are text checks over the repository. The real client is never
 * imported here: its behaviour is checked by the opt-in live test.
 */

const ROOT = process.cwd();

// Names are built from parts so that this file holds none of the strings it
// looks for.
const SDK_PACKAGE = ["@anthropic-ai", "sdk"].join("/");
const CLIENT_FILE = "lib/judge/haiku.ts";
const CLIENT_MODULE_TAIL = ["judge", "haiku"].join("/");
const LIVE_TEST_FILE = "tests/judge/live/judge-live.test.ts";
const HOOK_WORD = ["te", "st", "id"].join("");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...filesUnder(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

function posix(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const judgeSources = filesUnder(resolve(ROOT, "lib/judge"))
  .filter(isSource)
  .map(posix)
  .sort();

describe("the SDK import (15.2, 15.7, 1.16)", () => {
  it("names the SDK package in an import of a source file only in the real client", () => {
    const quoted = new RegExp(
      `(?:from|import|require|mock|importActual|importOriginal)\\s*\\(?\\s*["'\`]${escapeForRegExp(SDK_PACKAGE)}(?:/[^"'\`]*)?["'\`]`,
    );
    const roots = ["lib", "app", "components", "tests"].map((dir) => resolve(ROOT, dir));
    const offenders: string[] = [];
    for (const root of roots) {
      let files: string[];
      try {
        files = filesUnder(root);
      } catch {
        continue;
      }
      for (const file of files.filter(isSource)) {
        if (quoted.test(readFileSync(file, "utf8"))) offenders.push(posix(file));
      }
    }
    expect(offenders).toEqual([CLIENT_FILE]);
  });

  it("imports the real client in no file under tests except the live test", () => {
    const importOfClient = new RegExp(
      `(?:from|import|require|mock|importActual|importOriginal)\\s*\\(?\\s*["'\`][^"'\`]*${escapeForRegExp(CLIENT_MODULE_TAIL)}(?:\\.ts)?["'\`]`,
    );
    const offenders = filesUnder(resolve(ROOT, "tests"))
      .filter(isSource)
      .map(posix)
      .filter((file) => file !== LIVE_TEST_FILE)
      .filter((file) => importOfClient.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("imports the real client in no file under lib, app or components", () => {
    const importOfClient = new RegExp(
      `from\\s+["'\`][^"'\`]*${escapeForRegExp(CLIENT_MODULE_TAIL)}(?:\\.ts)?["'\`]`,
    );
    const offenders: string[] = [];
    for (const dir of ["lib", "app", "components"]) {
      let files: string[];
      try {
        files = filesUnder(resolve(ROOT, dir));
      } catch {
        continue;
      }
      for (const file of files.filter(isSource)) {
        if (importOfClient.test(readFileSync(file, "utf8"))) offenders.push(posix(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the real client file (15.1 to 15.6)", () => {
  const text = read(CLIENT_FILE);

  it("starts with the server-only import", () => {
    const firstImport = /^import\b[^\n]*$/m.exec(text);
    expect(firstImport?.[0]).toBe('import "server-only";');
  });

  it("loads the SDK with a dynamic import and has no static import of it", () => {
    expect(text).toContain(`await import("${SDK_PACKAGE}")`);
    const staticImport = new RegExp(
      `^import\\s+(?!type\\b)[^\\n;]*from\\s+["']${escapeForRegExp(SDK_PACKAGE)}`,
      "m",
    );
    expect(staticImport.test(text)).toBe(false);
  });

  it("turns the SDK's own retries off", () => {
    expect(text).toContain("maxRetries: 0");
  });

  it("builds the body with buildRequestBody and maps errors with toJudgeHttpError", () => {
    expect(text).toContain("buildRequestBody");
    expect(text).toContain("toJudgeHttpError");
  });

  it("passes the per-request timeout and signal", () => {
    expect(text).toContain("timeout: opts.timeoutMs");
    expect(text).toContain("signal: opts.signal");
  });

  it("sets no sampling temperature", () => {
    expect(text.toLowerCase()).not.toContain("temperature");
  });
});

describe("the test hook word (1.3, 1.4)", () => {
  it("occurs in no file under lib/judge, lib/detectors, lib/capture or tests/judge", () => {
    const offenders: string[] = [];
    for (const dir of ["lib/judge", "lib/detectors", "lib/capture", "tests/judge"]) {
      for (const file of filesUnder(resolve(ROOT, dir))) {
        if (readFileSync(file, "utf8").toLowerCase().includes(HOOK_WORD)) {
          offenders.push(posix(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the purity rules of lib/judge (1.1)", () => {
  it("finds the judge sources", () => {
    expect(judgeSources.length).toBeGreaterThan(10);
    expect(judgeSources).toContain(CLIENT_FILE);
  });

  it("reads no clock and uses no randomness", () => {
    const offenders = judgeSources.filter((file) => {
      const text = read(file);
      return /\bDate\.now\b/.test(text) || /\bMath\.random\b/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("holds no module-level mutable declaration", () => {
    const offenders = judgeSources.filter((file) => /^(?:export\s+)?(?:let|var)\s/m.test(read(file)));
    expect(offenders).toEqual([]);
  });
});

describe("the dependency (15.8)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("pins the SDK in dependencies at one exact version", () => {
    const value = pkg.dependencies[SDK_PACKAGE];
    expect(value).toMatch(/^\d+\.\d+\.\d+$/);
    expect(value?.startsWith("^")).toBe(false);
    expect(value?.startsWith("~")).toBe(false);
    expect(value).not.toContain("latest");
  });

  it("does not list the SDK as a dev dependency", () => {
    expect(pkg.devDependencies).not.toHaveProperty(SDK_PACKAGE);
  });
});
