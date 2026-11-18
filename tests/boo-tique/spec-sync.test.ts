import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { FIXED_SALE_TEXT } from "@/lib/boo-tique/content";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function lineStartingWith(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`No line starts with "${prefix}"`);
  }
  return line;
}

const FILES = [
  "docs/research/dark-patterns.md",
  ".kiro/specs/boo-tique-static/requirements.md",
  ".kiro/specs/boo-tique-static/design.md",
] as const;

describe("spec and research text stays in sync with the fixed sale date", () => {
  for (const file of FILES) {
    describe(file, () => {
      const text = read(file);

      it("quotes FIXED_SALE_TEXT", () => {
        expect(text).toContain(FIXED_SALE_TEXT);
      });

      it("no longer mentions the old date or the old sale name", () => {
        expect(text).not.toContain("31 Oct 2026");
        expect(text).not.toContain("Halloween sale");
      });
    });
  }

  it("keeps the research row for the selling-fast badge", () => {
    expect(read("docs/research/dark-patterns.md")).toContain(
      '"Selling fast" badge on all products, no number',
    );
  });

  it("quotes the new date in the home fixed-date row of dark-patterns.md", () => {
    const row = lineStartingWith(read("docs/research/dark-patterns.md"), "| 1 Home | \"Winter sale");
    expect(row).toBe(
      `| 1 Home | "${FIXED_SALE_TEXT}", fixed date, same on reload | none | look-alike | NO FLAG |`,
    );
  });

  it("quotes the new date on the line of old requirement 8.4", () => {
    const line = lineStartingWith(
      read(".kiro/specs/boo-tique-static/requirements.md"),
      "8.4.",
    );
    expect(line).toContain(FIXED_SALE_TEXT);
  });

  it("quotes the new date on the home-fixed-date-sale row of the old design", () => {
    const row = lineStartingWith(
      read(".kiro/specs/boo-tique-static/design.md"),
      "| home-fixed-date-sale |",
    );
    expect(row).toContain(FIXED_SALE_TEXT);
  });
});
