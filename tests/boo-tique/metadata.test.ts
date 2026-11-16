import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { booTiqueMetadata } from "@/lib/boo-tique/metadata";

const ROOT = process.cwd();
const LAYOUT_PATH = join(ROOT, "app", "boo-tique", "layout.tsx");

describe("booTiqueMetadata", () => {
  it("is noindex and nofollow", () => {
    expect(booTiqueMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("has a title and a description", () => {
    expect(typeof booTiqueMetadata.title).toBe("string");
    expect(typeof booTiqueMetadata.description).toBe("string");
  });
});

describe("app/boo-tique/layout.tsx wiring", () => {
  const source = readFileSync(LAYOUT_PATH, "utf8");

  it("imports next/font/google", () => {
    expect(source).toMatch(/from\s+["']next\/font\/google["']/);
  });

  it("loads Cormorant Garamond and Jost", () => {
    expect(source).toContain("Cormorant_Garamond");
    expect(source).toContain("Jost");
  });

  it("imports the Boo-tique stylesheet", () => {
    expect(source).toMatch(/import\s+["']\.\/boo-tique\.css["']/);
  });

  it("exports metadata from booTiqueMetadata", () => {
    expect(source).toMatch(
      /export\s+const\s+metadata(\s*:\s*Metadata)?\s*=\s*booTiqueMetadata\b/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bbooTiqueMetadata\b[^}]*\}\s*from\s*["']@\/lib\/boo-tique\/metadata["']/,
    );
  });

  it("renders the shell", () => {
    expect(source).toMatch(/<BooTiqueShell\b/);
  });
});

describe("route layout", () => {
  it("has no app/(boo-tique) route group", () => {
    expect(existsSync(join(ROOT, "app", "(boo-tique)"))).toBe(false);
  });

  it("keeps / served by app/page.tsx", () => {
    expect(existsSync(join(ROOT, "app", "page.tsx"))).toBe(true);
  });

  it("uses the real app/boo-tique segment", () => {
    expect(existsSync(LAYOUT_PATH)).toBe(true);
  });
});
