import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

const pkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8")
) as PackageJson;

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

describe("capture dependencies", () => {
  it("pins playwright-core to exactly 1.64.1", () => {
    expect(pkg.dependencies["playwright-core"]).toBe("1.64.1");
  });

  it("pins server-only to exactly 0.0.1", () => {
    expect(pkg.dependencies["server-only"]).toBe("0.0.1");
  });

  it("uses no range prefix and no latest tag for the two packages", () => {
    for (const name of ["playwright-core", "server-only"]) {
      const value = pkg.dependencies[name] ?? "";
      expect(value.startsWith("^")).toBe(false);
      expect(value.startsWith("~")).toBe(false);
      expect(value).not.toContain("latest");
    }
  });

  it("pins the Anthropic SDK of the model judge to exactly 1.12.0", () => {
    const value = pkg.dependencies["@anthropic-ai/sdk"];
    expect(value).toBe("1.12.0");
    expect(value?.startsWith("^")).toBe(false);
    expect(value?.startsWith("~")).toBe(false);
    expect(value).not.toContain("latest");
  });

  it("has no bundled Chromium package", () => {
    expect(pkg.dependencies).not.toHaveProperty("@sparticuz/chromium-min");
  });

  it("has no Browser Use SDK", () => {
    const vendorKeys = Object.keys(pkg.dependencies).filter((key) =>
      key.startsWith("browser-use")
    );
    expect(vendorKeys).toEqual([]);
  });

  it("pins the DOM test library as a dev dependency at exactly 31.0.1", () => {
    const value = pkg.devDependencies["jsdom"];
    expect(value).toBe("31.0.1");
    expect(value?.startsWith("^")).toBe(false);
    expect(value?.startsWith("~")).toBe(false);
    expect(value).not.toContain("latest");
  });

  it("keeps the runtime dependencies unchanged", () => {
    expect(pkg.dependencies).toEqual({
      "@anthropic-ai/sdk": "1.12.0",
      next: "^16.4.6",
      "playwright-core": "1.64.1",
      react: "^19.3.1",
      "react-dom": "^19.3.1",
      "server-only": "0.0.1",
      zod: "^4.6.7",
    });
  });

  it("adds no script", () => {
    expect(Object.keys(pkg.scripts).sort()).toEqual(
      ["dev", "build", "start", "lint", "typecheck", "test", "hooks:enable"].sort()
    );
  });

  it("does not mention the DOM test library in the vitest config", () => {
    const text = readFileSync(resolve(process.cwd(), "vitest.config.ts"), "utf8");
    expect(text).not.toContain("jsdom");
  });

  it("does not mention the DOM test library in any file under lib", () => {
    const offenders = filesUnder(resolve(process.cwd(), "lib")).filter((file) =>
      readFileSync(file, "utf8").includes("jsdom")
    );
    expect(offenders).toEqual([]);
  });

  it("pins the JPEG decoder of the live test as a dev dependency at exactly 0.4.4", () => {
    const value = pkg.devDependencies["jpeg-js"];
    expect(value).toBe("0.4.4");
    expect(value?.startsWith("^")).toBe(false);
    expect(value?.startsWith("~")).toBe(false);
    expect(value).not.toContain("latest");
  });

  it("does not list the JPEG decoder as a runtime dependency", () => {
    expect(pkg.dependencies).not.toHaveProperty("jpeg-js");
  });

  it("mentions the JPEG decoder in no file under lib or app", () => {
    for (const dir of ["lib", "app"]) {
      const offenders = filesUnder(resolve(process.cwd(), dir)).filter((file) =>
        readFileSync(file, "utf8").includes("jpeg-js")
      );
      expect(offenders, `files under ${dir} that mention the decoder`).toEqual([]);
    }
  });
});
