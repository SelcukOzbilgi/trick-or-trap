import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DEMO_NOTICE_TEXT, PRODUCTS } from "@/lib/boo-tique/content";
import { fixtureRoutes } from "./helpers/fixture";
import { renderRoute } from "./helpers/render-route";
import { attr, countTestId, visibleText } from "./helpers/markup";
import { BRAND_TRIPWIRE } from "./helpers/brand-tripwire";

const ROOT = process.cwd();
const SOURCE_DIRS = [
  join(ROOT, "app", "boo-tique"),
  join(ROOT, "components", "boo-tique"),
  join(ROOT, "lib", "boo-tique"),
];
const LAYOUT_FILE = join(ROOT, "app", "boo-tique", "layout.tsx");
const GROUND_TRUTH_MODULE = join(ROOT, "lib", "boo-tique", "ground-truth.ts");

const ALLOWED_USE_CLIENT = [
  "club-timer.tsx",
  "cookie-banner.tsx",
  "hero-countdown.tsx",
  "overlay-dialog.tsx",
  "sold-toast.tsx",
];

const PAYMENT_WORDS = /card|cvc|cvv|iban|expir|payment/i;
const EXTERNAL_URL = /^(https?:)?\/\//i;
const FORBIDDEN_ELEMENTS = ["<img", "<iframe", "<script", "<link"];

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(name)) out.push(full);
  }
  return out;
}

function codeFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) => listFiles(dir, /\.(ts|tsx)$/));
}

function shortName(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function wholeWord(name: string): RegExp {
  return new RegExp(`\\b${name}\\b`, "i");
}

function tagsOf(markup: string, element: string): string[] {
  return markup.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? [];
}

describe.each(fixtureRoutes())("fake-shop safety of %s", (route) => {
  it("shows the demo notice exactly once", async () => {
    const markup = await renderRoute(route);
    expect(countOccurrences(markup, DEMO_NOTICE_TEXT)).toBe(1);
    expect(countTestId(markup, "bt-demo-notice")).toBe(1);
  });

  it("has no form element", async () => {
    const markup = await renderRoute(route);
    expect(markup).not.toContain("<form");
  });

  it("has only checkbox or radio inputs with no payment-like name, id or autocomplete", async () => {
    const markup = await renderRoute(route);
    for (const tag of tagsOf(markup, "input")) {
      expect(["checkbox", "radio"], tag).toContain(attr(tag, "type"));
      for (const name of ["name", "id", "autocomplete"]) {
        expect(attr(tag, name) ?? "", `${name} in ${tag}`).not.toMatch(PAYMENT_WORDS);
      }
    }
  });

  it("gives every button type=button", async () => {
    const markup = await renderRoute(route);
    for (const tag of tagsOf(markup, "button")) {
      expect(attr(tag, "type"), tag).toBe("button");
    }
  });

  it("has no external href, src or action", async () => {
    const markup = await renderRoute(route);
    for (const name of ["href", "src", "action"]) {
      for (const match of markup.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))) {
        expect(match[1], `${name}="${match[1]}"`).not.toMatch(EXTERNAL_URL);
      }
    }
  });

  it("has no url() that points to an external host", async () => {
    const markup = await renderRoute(route);
    expect(markup).not.toMatch(/url\(\s*(&quot;|&#x27;|["'])?\s*(https?:)?\/\//i);
  });

  it("has no img, iframe, script or link element", async () => {
    const markup = await renderRoute(route);
    for (const element of FORBIDDEN_ELEMENTS) {
      expect(markup, element).not.toContain(element);
    }
  });

  it("names no real brand in its visible text", async () => {
    const text = visibleText(await renderRoute(route));
    for (const brand of BRAND_TRIPWIRE) {
      expect(text, brand).not.toMatch(wholeWord(brand));
    }
  });
});

describe("product names", () => {
  const ORIGINAL_NAMES = [
    "Cursed Candle Set",
    "Phantom Hoodie",
    "Moon-Phase Mug",
    "Crypt Keeper Tote",
    "Raven Feather Quill Pen",
    "Ghost Pepper Candle",
  ];

  it("keeps the product constant to the six original names", () => {
    expect(PRODUCTS.map((product) => product.name)).toEqual(ORIGINAL_NAMES);
  });

  it("shows exactly the six original names in the home grid", async () => {
    const markup = await renderRoute("/boo-tique");
    const names = [...markup.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
    expect(names).toEqual(ORIGINAL_NAMES);
  });
});

describe("source scans", () => {
  it("finds source files to scan in all three directories", () => {
    for (const dir of SOURCE_DIRS) {
      expect(listFiles(dir, /\.(ts|tsx)$/).length, dir).toBeGreaterThan(0);
    }
  });

  for (const word of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]) {
    it(`contains no ${word}`, () => {
      for (const file of codeFiles()) {
        expect(readFileSync(file, "utf8"), shortName(file)).not.toContain(word);
      }
    });
  }

  for (const word of ["next/link", "next/image", "next/navigation"]) {
    it(`imports no ${word}`, () => {
      for (const file of codeFiles()) {
        expect(readFileSync(file, "utf8"), shortName(file)).not.toContain(word);
      }
    });
  }

  it("imports next/font only in app/boo-tique/layout.tsx", () => {
    expect(readFileSync(LAYOUT_FILE, "utf8")).toContain("next/font/google");
    for (const file of codeFiles()) {
      if (file === LAYOUT_FILE) continue;
      expect(readFileSync(file, "utf8"), shortName(file)).not.toContain("next/font");
    }
  });

  it("imports neither the fixture nor ground-truth outside lib/boo-tique/ground-truth.ts", () => {
    const specifier =
      /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g;
    for (const file of codeFiles()) {
      if (file === GROUND_TRUTH_MODULE) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(specifier)) {
        expect(match[1], shortName(file)).not.toMatch(/ground-truth|fixtures/);
      }
    }
  });

  it("contains no brand name from BRAND_TRIPWIRE in the source text", () => {
    const files = SOURCE_DIRS.flatMap((dir) => listFiles(dir, /\.(ts|tsx|css)$/));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const brand of BRAND_TRIPWIRE) {
        expect(source, `${brand} in ${shortName(file)}`).not.toMatch(wholeWord(brand));
      }
    }
  });

  it("has use client in exactly the five allowed files", () => {
    const found = codeFiles()
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.split(sep).pop())
      .sort();
    expect(found).toEqual([...ALLOWED_USE_CLIENT].sort());
  });

  it("keeps the use client files under components/boo-tique", () => {
    for (const file of codeFiles()) {
      if (/^\s*["']use client["']/.test(readFileSync(file, "utf8"))) {
        expect(shortName(file).startsWith("components/boo-tique/"), shortName(file)).toBe(true);
      }
    }
  });
});
