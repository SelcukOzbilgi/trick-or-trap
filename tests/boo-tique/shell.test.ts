import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BooTiqueShell } from "@/components/boo-tique/shell";
import {
  BOO_TIQUE_BASE_PATH,
  DEMO_NOTICE_TEXT,
  NAV_LINKS,
} from "@/lib/boo-tique/content";

const ROOT = process.cwd();

function render(fontClassName?: string): string {
  return renderToStaticMarkup(
    createElement(
      BooTiqueShell,
      { fontClassName },
      createElement("p", null, "Page body"),
    ),
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("BooTiqueShell markup", () => {
  it("has the demo notice text constant", () => {
    expect(DEMO_NOTICE_TEXT).toBe("Demo shop, nothing is for sale");
    expect(BOO_TIQUE_BASE_PATH).toBe("/boo-tique");
  });

  it("renders exactly one bt-root wrapper", () => {
    const markup = render();
    expect(countOccurrences(markup, "bt-root")).toBe(1);
    expect(markup.startsWith('<div class="bt-root')).toBe(true);
  });

  it("renders the demo notice once, on the bt-demo-notice element", () => {
    const markup = render();
    expect(countOccurrences(markup, DEMO_NOTICE_TEXT)).toBe(1);
    expect(countOccurrences(markup, 'data-testid="bt-demo-notice"')).toBe(1);
    const match = /<[a-z]+[^>]*data-testid="bt-demo-notice"[^>]*>([^<]*)</.exec(
      markup,
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(DEMO_NOTICE_TEXT);
  });

  it("renders its children inside main", () => {
    const markup = render();
    expect(markup).toMatch(/<main[^>]*>[\s\S]*<p>Page body<\/p>[\s\S]*<\/main>/);
  });

  it("outputs no html or body element", () => {
    const markup = render();
    expect(markup).not.toContain("<html");
    expect(markup).not.toContain("<body");
  });

  it("uses plain anchors with relative /boo-tique hrefs", () => {
    const markup = render();
    const hrefs = [...markup.matchAll(/<a [^>]*href="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith("/boo-tique")).toBe(true);
    }
    for (const link of NAV_LINKS) {
      expect(hrefs).toContain(link.href);
    }
  });

  it("lists the nav links in the order Home, Cart, Checkout, Club, Account", () => {
    const expected = [
      "/boo-tique",
      "/boo-tique/cart",
      "/boo-tique/checkout",
      "/boo-tique/club",
      "/boo-tique/account/subscription",
    ];
    expect(NAV_LINKS.map((link) => link.href)).toEqual(expected);
    expect(NAV_LINKS.map((link) => link.label)).toEqual([
      "Home",
      "Cart",
      "Checkout",
      "Club",
      "Account",
    ]);
    const nav = /<nav\b[\s\S]*?<\/nav>/.exec(render());
    expect(nav).not.toBeNull();
    const hrefs = [...(nav?.[0] ?? "").matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(expected);
  });

  it("applies fontClassName to the wrapper", () => {
    const markup = render("font-a font-b");
    const wrapper = /^<div class="([^"]*)"/.exec(markup);
    expect(wrapper).not.toBeNull();
    const classes = (wrapper?.[1] ?? "").split(/\s+/);
    expect(classes).toContain("bt-root");
    expect(classes).toContain("font-a");
    expect(classes).toContain("font-b");
  });

  it("carries no ground-truth entry id or verdict wording", () => {
    const markup = render();
    expect(markup).not.toContain("no-flag");
    expect(markup).not.toContain("lookalike");
    const ids = [...markup.matchAll(/data-testid="([^"]*)"/g)].map((m) => m[1]);
    for (const id of ids) {
      expect(id.startsWith("bt-")).toBe(true);
    }
  });
});

describe("source scans for forbidden next modules", () => {
  const dirs = [
    join(ROOT, "components", "boo-tique"),
    join(ROOT, "lib", "boo-tique"),
  ];
  const forbidden = ["next/font", "next/link", "next/image", "next/navigation"];

  it("finds source files to scan", () => {
    for (const dir of dirs) {
      expect(sourceFiles(dir).length).toBeGreaterThan(0);
    }
  });

  for (const word of forbidden) {
    it(`no module under components/boo-tique or lib/boo-tique mentions ${word}`, () => {
      for (const dir of dirs) {
        for (const file of sourceFiles(dir)) {
          expect(readFileSync(file, "utf8"), file).not.toContain(word);
        }
      }
    });
  }
});
