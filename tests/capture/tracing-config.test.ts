import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const configText = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

describe("next.config.ts file tracing", () => {
  it("includes playwright-core for the /api/scan route", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/scan"]).toEqual([
      "./node_modules/playwright-core/**/*",
    ]);
  });

  it("lists only the /api/scan route in the tracing includes", () => {
    expect(Object.keys(nextConfig.outputFileTracingIncludes ?? {})).toEqual([
      "/api/scan",
    ]);
  });

  it("keeps every other setting unchanged (the config had none before)", () => {
    expect(Object.keys(nextConfig)).toEqual(["outputFileTracingIncludes"]);
  });

  it("carries a comment that names lib/capture", () => {
    const commentLines = configText
      .split("\n")
      .filter((line) => line.trim().startsWith("//") || line.trim().startsWith("*"));
    expect(commentLines.some((line) => line.includes("lib/capture"))).toBe(true);
  });
});
