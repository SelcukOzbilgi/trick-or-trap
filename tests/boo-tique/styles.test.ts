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
import { contrastRatio } from "@/lib/boo-tique/contrast";

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

type MediaBlock = { query: string; css: string };

/**
 * Walks the comment-stripped text with a brace counter. Returns the text with every
 * @media block removed, and the blocks with their whitespace-normalised query.
 */
function splitMedia(source: string): { base: string; media: MediaBlock[] } {
  const text = stripComments(source);
  const media: MediaBlock[] = [];
  let base = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("@media", i)) {
      const open = text.indexOf("{", i);
      if (open === -1) throw new Error("@media without a block");
      const query = text.slice(i + "@media".length, open).replace(/\s+/g, " ").trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
        j += 1;
      }
      if (depth !== 0) throw new Error("unbalanced @media block");
      media.push({ query, css: text.slice(open + 1, j - 1) });
      i = j;
    } else {
      base += text[i];
      i += 1;
    }
  }
  return { base, media };
}

const css = readFileSync(CSS_PATH, "utf8");
const { base: baseCss, media: mediaBlocks } = splitMedia(css);
const rules = parseRules(baseCss);
const mediaRules = mediaBlocks.flatMap((block) => parseRules(block.css));
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
    expect(cssNoComments).not.toMatch(/\bhtml\b/);
    expect(cssNoComments).not.toContain(":has(");
  });

  it("scopes every selector to a bt- class", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of [...rules, ...mediaRules]) {
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

describe("boo-tique.css phone layout (media block)", () => {
  it("has exactly one @media block, for max-width 640px", () => {
    expect(mediaBlocks).toHaveLength(1);
    expect(mediaBlocks[0].query).toBe("(max-width: 640px)");
    expect((cssNoComments.match(/@media/g) ?? []).length).toBe(1);
  });

  it("wraps the banner and lifts its height limit", () => {
    const d = declsFor(mediaRules, ".bt-banner");
    expect(d.get("flex-wrap")).toBe("wrap");
    expect(d.get("max-height")).toBe("none");
  });

  it("gives the banner paragraph the full row at 14px", () => {
    const d = declsFor(mediaRules, ".bt-banner p");
    expect(d.get("flex-basis")).toBe("100%");
    expect(d.get("font-size")).toBe("14px");
    expect(d.get("margin")).toBe("0");
  });

  it("lets the banner actions wrap", () => {
    expect(declsFor(mediaRules, ".bt-banner-actions").get("flex-wrap")).toBe("wrap");
  });

  it("grows the bottom padding to 176px", () => {
    expect(declsFor(mediaRules, ".bt-root").get("padding-bottom")).toBe("176px");
  });

  it("uses two grid columns", () => {
    expect(declsFor(mediaRules, ".bt-grid").get("grid-template-columns")).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
  });

  it("keeps the media rules after the base banner and root rules", () => {
    const bannerBase = cssNoComments.indexOf(".bt-banner {");
    const rootBase = cssNoComments.indexOf(".bt-root {");
    const media = cssNoComments.indexOf("@media");
    expect(bannerBase).toBeGreaterThan(-1);
    expect(rootBase).toBeGreaterThan(-1);
    expect(media).toBeGreaterThan(bannerBase);
    expect(media).toBeGreaterThan(rootBase);
  });

  it("keeps the base values above 640px", () => {
    expect(declsFor(rules, ".bt-grid").get("grid-template-columns")).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
    expect(declsFor(rules, ".bt-banner").get("max-height")).toBe("96px");
    expect(declsFor(rules, ".bt-root").get("padding-bottom")).toBe("112px");
    expect(declsFor(rules, ".bt-card").get("min-width")).toBe("0");
    expect(declsFor(rules, ".bt-root").get("overflow-wrap")).toBe("break-word");
  });

  it("declares the banner actions group", () => {
    const d = declsFor(rules, ".bt-banner-actions");
    expect(d.get("display")).toBe("flex");
    expect(d.get("gap")).toBe("8px");
    expect(d.get("align-items")).toBe("center");
    expect(d.get("flex")).toBe("none");
  });

  it("fits both equal buttons into a 390px phone", () => {
    const minWidth = Number.parseInt(String(EQUAL_BUTTON_STYLE.minWidth), 10);
    const gap = Number.parseInt(declsFor(rules, ".bt-banner-actions").get("gap") ?? "", 10);
    const sidePadding = Number.parseInt(
      (declsFor(rules, ".bt-banner").get("padding") ?? "").split(/\s+/)[1] ?? "",
      10,
    );
    expect(minWidth).toBe(160);
    expect(gap).toBe(8);
    expect(sidePadding).toBe(16);
    expect(2 * minWidth + gap).toBe(328);
    expect(2 * minWidth + gap).toBeLessThanOrEqual(390 - 2 * sidePadding);
  });
});

describe("boo-tique.css type scale and accent", () => {
  it("sets the heading sizes", () => {
    const h1 = declsFor(rules, ".bt-root h1");
    expect([h1.get("font-size"), h1.get("font-weight"), h1.get("line-height")]).toEqual([
      "40px",
      "700",
      "1.1",
    ]);
    const h2 = declsFor(rules, ".bt-root h2");
    expect([h2.get("font-size"), h2.get("font-weight"), h2.get("line-height")]).toEqual([
      "28px",
      "600",
      "1.2",
    ]);
    const h3 = declsFor(rules, ".bt-root h3");
    expect([h3.get("font-size"), h3.get("font-weight"), h3.get("line-height")]).toEqual([
      "20px",
      "600",
      "1.25",
    ]);
  });

  it("keeps the Cormorant family on the combined heading rule", () => {
    const combined = rules.find((r) => {
      const parts = r.selector.split(",").map((s) => s.trim());
      return parts.join("|") === ".bt-root h1|.bt-root h2|.bt-root h3";
    });
    expect(combined).toBeDefined();
    expect(combined?.decls.get("font-family")).toContain("var(--font-cormorant)");
  });

  it("puts the size rules after the combined heading rule", () => {
    const combined = cssNoComments.indexOf(".bt-root h1,");
    expect(combined).toBeGreaterThan(-1);
    for (const tag of ["h1", "h2", "h3"]) {
      const match = new RegExp(`^\\.bt-root ${tag} \\{`, "m").exec(cssNoComments);
      expect(match, tag).not.toBeNull();
      expect(match?.index ?? -1).toBeGreaterThan(combined);
    }
  });

  it("uses the blood colour as the accent colour", () => {
    expect(declsFor(rules, ".bt-root").get("accent-color")).toBe("var(--bt-blood)");
  });
});

describe("boo-tique.css hero", () => {
  it("styles the hero band", () => {
    const d = declsFor(rules, ".bt-hero");
    expect(d.get("width")).toBe("100%");
    expect(d.get("padding")).toBe("32px");
    expect(d.get("border-radius")).toBe("12px");
    expect(d.get("background")).toBe("var(--bt-blood)");
    expect(d.get("color")).toBe("#ffffff");
  });

  it("styles the hero heading and tagline", () => {
    expect(declsFor(rules, ".bt-hero h1").get("color")).toBe("#ffffff");
    const tagline = declsFor(rules, ".bt-hero .bt-hero-tagline");
    expect(tagline.get("font-size")).toBe("18px");
    expect(tagline.get("color")).toBe("var(--bt-paper)");
    expect(tagline.get("margin")).toBe("0");
  });

  it("gives the three promo lines one size, one weight and one margin", () => {
    const d = declsFor(rules, ".bt-hero .bt-promo p");
    expect(d.get("font-size")).toBe("28px");
    expect(d.get("font-weight")).toBe("600");
    expect(d.get("line-height")).toBe("1.2");
    expect(d.get("margin")).toBe("0");
  });
});

describe("boo-tique.css product tiles", () => {
  const classes = [".bt-tile--candle", ".bt-tile--hoodie", ".bt-tile--mug", ".bt-tile--tote", ".bt-tile--quill"];

  it("declares five different gradients made from palette tokens", () => {
    const backgrounds = classes.map((sel) => declsFor(rules, sel).get("background") ?? "");
    for (const background of backgrounds) {
      expect(background.startsWith("linear-gradient(")).toBe(true);
      expect(background).not.toContain("#");
      const vars = background.match(/var\(([^)]*)\)/g) ?? [];
      expect(vars.length).toBeGreaterThan(0);
      for (const v of vars) expect(v.startsWith("var(--bt-")).toBe(true);
    }
    expect(new Set(backgrounds).size).toBe(5);
  });
});

describe("boo-tique.css buttons", () => {
  it("styles the base button", () => {
    const d = declsFor(rules, ".bt-root .bt-button");
    expect(d.get("display")).toBe("inline-flex");
    expect(d.get("align-items")).toBe("center");
    expect(d.get("justify-content")).toBe("center");
    expect(d.get("padding")).toBe("12px 24px");
    expect(d.get("min-height")).toBe("44px");
    expect(d.get("border")).toBe("2px solid var(--bt-blood)");
    expect(d.get("border-radius")).toBe("8px");
    expect(d.get("background")).toBe("var(--bt-blood)");
    expect(d.get("color")).toBe("#ffffff");
    expect(d.get("font-weight")).toBe("600");
    expect(d.get("text-decoration")).toBe("none");
    expect(d.get("cursor")).toBe("pointer");
  });

  it("styles hover, focus and disabled", () => {
    const hover = declsFor(rules, ".bt-root .bt-button:hover");
    expect(hover.get("background")).toBe("var(--bt-blood-dark)");
    expect(hover.get("border-color")).toBe("var(--bt-blood-dark)");
    const focus = declsFor(rules, ".bt-root .bt-button:focus-visible");
    expect(focus.get("outline")).toBe("3px solid var(--bt-ink)");
    expect(focus.get("outline-offset")).toBe("2px");
    const disabled = declsFor(rules, ".bt-root .bt-button:disabled");
    expect(disabled.get("background")).toBe("var(--bt-paper)");
    expect(disabled.get("border-color")).toBe("var(--bt-muted)");
    expect(disabled.get("color")).toBe("var(--bt-muted)");
    expect(disabled.get("cursor")).toBe("not-allowed");
  });

  it("styles the secondary and quiet modifiers", () => {
    const secondary = declsFor(rules, ".bt-root .bt-button--secondary");
    expect(secondary.get("background")).toBe("transparent");
    expect(secondary.get("color")).toBe("var(--bt-blood)");
    expect(secondary.get("border-color")).toBe("var(--bt-blood)");
    expect(declsFor(rules, ".bt-root .bt-button--secondary:hover").get("background")).toBe(
      "var(--bt-paper)",
    );
    const quiet = declsFor(rules, ".bt-root .bt-button--quiet");
    expect(quiet.get("background")).toBe("transparent");
    expect(quiet.get("border-color")).toBe("transparent");
    expect(quiet.get("color")).toBe("var(--bt-blood)");
    expect(quiet.get("padding")).toBe("8px 12px");
    expect(quiet.get("font-weight")).toBe("500");
    const quietHover = declsFor(rules, ".bt-root .bt-button--quiet:hover");
    expect(quietHover.get("text-decoration")).toBe("underline");
    expect(quietHover.get("background")).toBe("transparent");
    expect(quietHover.get("border-color")).toBe("transparent");
  });

  it("keeps the file order of the button rules", () => {
    const at = (selector: string) => {
      const index = cssNoComments.indexOf(`${selector} {`);
      expect(index, selector).toBeGreaterThan(-1);
      return index;
    };
    const base = at(".bt-root .bt-button");
    const hover = at(".bt-root .bt-button:hover");
    expect(at(".bt-root .bt-button--secondary")).toBeGreaterThan(base);
    expect(at(".bt-root .bt-button--quiet")).toBeGreaterThan(base);
    expect(at(".bt-root .bt-button:disabled")).toBeGreaterThan(hover);
    expect(at(".bt-root .bt-button--secondary:hover")).toBeGreaterThan(hover);
    expect(at(".bt-root .bt-button--quiet:hover")).toBeGreaterThan(hover);
  });

  it("writes every button selector with the .bt-root prefix", () => {
    for (const rule of [...rules, ...mediaRules]) {
      for (const sel of rule.selector.split(",")) {
        if (sel.includes("bt-button")) expect(sel.trim().startsWith(".bt-root ")).toBe(true);
      }
    }
  });
});

describe("boo-tique.css rows", () => {
  it("styles the choice row and its input", () => {
    const row = declsFor(rules, ".bt-choice-row");
    expect(row.get("display")).toBe("flex");
    expect(row.get("align-items")).toBe("center");
    expect(row.get("justify-content")).toBe("flex-start");
    expect(row.get("gap")).toBe("12px");
    expect(row.get("padding")).toBe("8px 12px");
    expect(row.get("border")).toBe("1px solid var(--bt-line)");
    expect(row.get("border-radius")).toBe("8px");
    const input = declsFor(rules, ".bt-choice-row input");
    expect(input.get("flex")).toBe("none");
    expect(input.get("width")).toBe("20px");
    expect(input.get("height")).toBe("20px");
    expect(input.get("margin")).toBe("0");
  });

  it("styles the line row", () => {
    const d = declsFor(rules, ".bt-line-row");
    expect(d.get("display")).toBe("grid");
    expect(d.get("grid-template-columns")).toBe("minmax(0, 1fr) auto auto");
    expect(d.get("align-items")).toBe("center");
    expect(d.get("gap")).toBe("12px");
    expect(d.get("padding")).toBe("8px 12px");
    expect(d.get("border")).toBe("1px solid var(--bt-line)");
    expect(d.get("border-radius")).toBe("8px");
  });
});

describe("boo-tique.css colours and vocabulary", () => {
  it("has no hex literal outside the seven tokens except lower case #ffffff", () => {
    for (const rule of [...rules, ...mediaRules]) {
      for (const [property, value] of rule.decls) {
        if (property.startsWith("--bt-")) continue;
        for (const hex of value.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
          expect(hex).toBe("#ffffff");
        }
      }
    }
  });

  it("meets the contrast pairs", () => {
    const white = "#ffffff";
    expect(contrastRatio(white, PALETTE.blood)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.paper, PALETTE.blood)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.blood, PALETTE.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.blood, PALETTE.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.muted, PALETTE.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(PALETTE.ink, PALETTE.bg)).toBeGreaterThanOrEqual(3);
  });

  it("names no pattern in any selector or declaration", () => {
    expect(cssNoComments).not.toMatch(
      /urgency|scarcity|activity|shaming|preselect|interference|sneak|drip/i,
    );
  });
});

describe("app/globals.css", () => {
  it("contains no --bt- declaration", () => {
    expect(readFileSync(GLOBALS_PATH, "utf8")).not.toContain("--bt-");
  });
});
