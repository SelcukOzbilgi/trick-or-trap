import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = { dependencies: Record<string, string> };

const pkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8")
) as PackageJson;

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

  it("has no bundled Chromium package", () => {
    expect(pkg.dependencies).not.toHaveProperty("@sparticuz/chromium-min");
  });

  it("has no Browser Use SDK", () => {
    const vendorKeys = Object.keys(pkg.dependencies).filter((key) =>
      key.startsWith("browser-use")
    );
    expect(vendorKeys).toEqual([]);
  });
});
