import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PALETTE,
  OPTIONS_LINK_STYLE,
  ACCEPT_ALL_STYLE,
  GHOST_ACCEPT_STYLE,
  GHOST_REJECT_STYLE,
  EQUAL_BUTTON_STYLE,
  ALMOST_GONE_STYLE,
  UPSELL_ADD_STYLE,
  UPSELL_CLOSE_STYLE,
} from "@/lib/boo-tique/styles";

const ROOT = process.cwd();
const CSS_PATH = join(ROOT, "app", "boo-tique", "boo-tique.css");
const GLOBALS_PATH = join(ROOT, "app", "globals.css");

type Rule = { selector: string; decls: Map<string, string> };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripComments(css))) !== null) {
    const decls = new Map<string, string>();
    for (const part of m[2].split(";")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      decls.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
    rules.push({ selector: m[1].trim(), decls });
  }
  return rules;
}

function declsFor(rules: Rule[], selector: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const r of rules.filter((x) => x.selector === selector)) {
    for (const [k, v] of r.decls) merged.set(k, v);
  }
  return merged;
}

const css = readFileSync(CSS_PATH, "utf8");
const rules = parseRules(css);
const cssNoComments = stripComments(css);

describe("palette constants", () => {
  it("has the exact hex values", () => {
    expect(PALETTE).toEqual({
      bg: "#fbf3e4",
      paper: "#fff9ee",
      ink: "#2a1512",
      blood: "#8b1a1a",
      bloodDark: "#6e1212",
      muted: "#6b5a52",
      line: "#e3d2b2",
    });
  });

  it("is lower case", () => {
    for (const value of Object.values(PALETTE)) {
      expect(value).toBe(value.toLowerCase());
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("style constants", () => {
  it("styles the default banner options link", () => {
    expect(OPTIONS_LINK_STYLE).toEqual({
      fontSize: "11px",
      color: "#9a9a9a",
      textDecoration: "underline",
    });
  });

  it("styles the default Accept all button", () => {
    expect(ACCEPT_ALL_STYLE).toEqual({
      fontSize: "20px",
      fontWeight: 700,
      padding: "16px 48px",
      minHeight: "56px",
      background: "#8b1a1a",
      color: "#ffffff",
      border: 0,
      borderRadius: "8px",
    });
  });

  it("gives the ghost banner the same Accept all style", () => {
    expect(GHOST_ACCEPT_STYLE).toEqual(ACCEPT_ALL_STYLE);
  });

  it("styles the ghost Reject button with opacity 0.6", () => {
    expect(GHOST_REJECT_STYLE).toEqual({
      fontSize: "14px",
      color: "#b3b3b3",
      background: "transparent",
      border: "1px solid #b3b3b3",
      padding: "8px 20px",
      opacity: 0.6,
    });
  });

  it("styles the shared equal button", () => {
    expect(EQUAL_BUTTON_STYLE).toEqual({
      fontSize: "16px",
      fontWeight: 600,
      padding: "12px 32px",
      minWidth: "160px",
      minHeight: "48px",
      background: "#8b1a1a",
      color: "#ffffff",
      border: "2px solid #8b1a1a",
      borderRadius: "8px",
      opacity: 1,
    });
  });

  it("styles the Almost gone label", () => {
    expect(ALMOST_GONE_STYLE).toEqual({ fontSize: "10px", color: "#9a9a9a" });
  });

  it("styles the upsell add button", () => {
    expect(UPSELL_ADD_STYLE).toEqual({
      fontSize: "20px",
      fontWeight: 700,
      padding: "16px 32px",
      width: "100%",
      background: "#8b1a1a",
      color: "#ffffff",
    });
  });

  it("styles the upsell close button", () => {
    expect(UPSELL_CLOSE_STYLE).toEqual({
      fontSize: "8px",
      lineHeight: 1,
      color: "#cfc6bc",
      background: "transparent",
      border: 0,
      padding: 0,
    });
  });

  it("writes every hex colour in lower case", () => {
    const all = JSON.stringify([
      PALETTE,
      OPTIONS_LINK_STYLE,
      ACCEPT_ALL_STYLE,
      GHOST_ACCEPT_STYLE,
      GHOST_REJECT_STYLE,
      EQUAL_BUTTON_STYLE,
      ALMOST_GONE_STYLE,
      UPSELL_ADD_STYLE,
      UPSELL_CLOSE_STYLE,
    ]);
    for (const hex of all.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(hex).toBe(hex.toLowerCase());
    }
  });
});

describe("boo-tique.css tokens", () => {
  const root = declsFor(rules, ".bt-root");

  it("declares --bt-* tokens equal to the palette constants", () => {
    expect(root.get("--bt-bg")).toBe(PALETTE.bg);
    expect(root.get("--bt-paper")).toBe(PALETTE.paper);
    expect(root.get("--bt-ink")).toBe(PALETTE.ink);
    expect(root.get("--bt-blood")).toBe(PALETTE.blood);
    expect(root.get("--bt-blood-dark")).toBe(PALETTE.bloodDark);
    expect(root.get("--bt-muted")).toBe(PALETTE.muted);
    expect(root.get("--bt-line")).toBe(PALETTE.line);
  });

  it("declares exactly the seven palette tokens", () => {
    const names = [...root.keys()].filter((k) => k.startsWith("--")).sort();
    expect(names).toEqual(
      [
        "--bt-bg",
        "--bt-blood",
        "--bt-blood-dark",
        "--bt-ink",
        "--bt-line",
        "--bt-muted",
        "--bt-paper",
      ].sort(),
    );
  });

  it("declares custom properties only under .bt-root", () => {
    for (const rule of rules) {
      const custom = [...rule.decls.keys()].filter((k) => k.startsWith("--"));
      if (custom.length > 0) expect(rule.selector).toBe(".bt-root");
    }
  });

  it("has no @theme, --color-, :root or body", () => {
    expect(cssNoComments).not.toContain("@theme");
    expect(cssNoComments).not.toContain("--color-");
    expect(cssNoComments).not.toContain(":root");
    expect(cssNoComments).not.toMatch(/\bbody\b/);
  });

  it("scopes every selector to a bt- class", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const sel of rule.selector.split(",")) {
        expect(sel.trim().startsWith(".bt-")).toBe(true);
      }
    }
  });

  it("does not import or declare anything outside rules", () => {
    expect(cssNoComments).not.toMatch(/@import/);
    expect(cssNoComments).not.toMatch(/url\(/);
  });
});

describe("boo-tique.css wrapper", () => {
  const root = declsFor(rules, ".bt-root");

  it("fills the viewport with its own background", () => {
    expect(root.get("min-height")).toBe("100dvh");
    expect(root.get("background")).toBe("var(--bt-bg)");
  });

  it("uses the ink colour and reserves room for the cookie banner", () => {
    expect(root.get("color")).toBe("var(--bt-ink)");
    expect(root.get("padding-bottom")).toBe("112px");
  });
});

describe("boo-tique.css overlay placement", () => {
  it("places the banner", () => {
    const d = declsFor(rules, ".bt-banner");
    expect(d.get("position")).toBe("fixed");
    expect(d.get("bottom")).toBe("0");
    expect(d.get("left")).toBe("0");
    expect(d.get("right")).toBe("0");
    expect(d.get("max-height")).toBe("96px");
    expect(d.get("z-index")).toBe("40");
  });

  it("places the backdrop", () => {
    const d = declsFor(rules, ".bt-backdrop");
    expect(d.get("position")).toBe("fixed");
    expect(d.get("inset")).toBe("0");
    expect(d.get("z-index")).toBe("50");
    expect(d.get("background")).toBe("rgba(42, 21, 18, 0.45)");
  });

  it("places the dialog", () => {
    const d = declsFor(rules, ".bt-dialog");
    expect(d.get("position")).toBe("fixed");
    expect(d.get("top")).toBe("50%");
    expect(d.get("left")).toBe("50%");
    expect(d.get("transform")).toBe("translate(-50%, -50%)");
    expect(d.get("max-width")).toBe("480px");
    expect(d.get("max-height")).toBe("80vh");
    expect(d.get("z-index")).toBe("60");
  });

  it("places the toast", () => {
    const d = declsFor(rules, ".bt-toast");
    expect(d.get("position")).toBe("fixed");
    expect(d.get("bottom")).toBe("16px");
    expect(d.get("left")).toBe("16px");
    expect(d.get("width")).toBe("320px");
    expect(d.get("z-index")).toBe("70");
  });

  it("orders the stacking banner < backdrop < dialog < toast", () => {
    const z = (sel: string) => Number(declsFor(rules, sel).get("z-index"));
    expect(z(".bt-banner")).toBeLessThan(z(".bt-backdrop"));
    expect(z(".bt-backdrop")).toBeLessThan(z(".bt-dialog"));
    expect(z(".bt-dialog")).toBeLessThan(z(".bt-toast"));
  });

  it("aligns the toggle knob with flex", () => {
    expect(declsFor(rules, ".bt-toggle").get("display")).toBe("inline-flex");
    expect(declsFor(rules, '.bt-toggle[aria-checked="true"]').get("justify-content")).toBe(
      "flex-end",
    );
  });
});

describe("app/globals.css", () => {
  it("contains no --bt- declaration", () => {
    expect(readFileSync(GLOBALS_PATH, "utf8")).not.toContain("--bt-");
  });
});
