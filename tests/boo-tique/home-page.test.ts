import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import {
  attr,
  countTestId,
  hasAttr,
  openTag,
  textOf,
  visibleText,
} from "./helpers/markup";

/** Local one-entry table, used by the grid and urgency tests. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique", load: () => import("@/app/boo-tique/page") },
];

function render(route: string): Promise<string> {
  return renderRoute(route, { table: TABLE });
}

const PRODUCTS: ReadonlyArray<readonly [string, string]> = [
  ["Cursed Candle Set", "$24"],
  ["Phantom Hoodie", "$58"],
  ["Moon-Phase Mug", "$22"],
  ["Crypt Keeper Tote", "$26"],
  ["Raven Feather Quill Pen", "$14"],
  ["Ghost Pepper Candle", "$18"],
];

describe("home page product grid", () => {
  it("shows the six product names and prices", async () => {
    const markup = await render("/boo-tique");
    const text = visibleText(markup);
    for (const [name, price] of PRODUCTS) {
      expect(text, name).toContain(name);
      expect(text, price).toContain(price);
    }
  });

  it("renders six product cards", async () => {
    const markup = await render("/boo-tique");
    expect(markup.split('data-testid="bt-product-card"').length - 1).toBe(6);
  });

  it("links only the Ghost Pepper Candle card", async () => {
    const markup = await render("/boo-tique");
    const cards = markup.split('data-testid="bt-product-card"').slice(1);
    const withLink = cards.filter((card) => {
      const end = card.indexOf("</li>");
      return /<a /.test(card.slice(0, end));
    });
    expect(withLink).toHaveLength(1);
    expect(withLink[0]).toContain("Ghost Pepper Candle");
    expect(withLink[0]).toContain(
      'href="/boo-tique/product/ghost-pepper-candle"',
    );
  });

  it("outputs no img element", async () => {
    const markup = await render("/boo-tique");
    expect(markup).not.toContain("<img");
  });

  it("shows no was/now price", async () => {
    const markup = await render("/boo-tique");
    expect(markup).not.toContain("<s>");
    expect(markup).not.toContain("<del");
    expect(markup).not.toContain("line-through");
  });
});

describe("home page urgency block", () => {
  it("shows the exact texts of the three urgency entries", async () => {
    const markup = await render("/boo-tique");
    expect(textOf(markup, "home-hero-countdown-restart")).toBe(
      "Boo-nanza ends in 04:59:59",
    );
    expect(textOf(markup, "home-rolling-midnight-text")).toBe(
      "Black Friday of the Dead ends at midnight",
    );
    expect(textOf(markup, "home-fixed-date-sale")).toBe(
      "Winter sale ends 28 Feb 2027, 23:59 UTC",
    );
  });

  it("has each urgency test id exactly once", async () => {
    const markup = await render("/boo-tique");
    for (const id of [
      "home-hero-countdown-restart",
      "home-rolling-midnight-text",
      "home-fixed-date-sale",
    ]) {
      expect(countTestId(markup, id), id).toBe(1);
    }
  });

  it("outputs identical fixed-date and rolling-midnight text in two renders", async () => {
    const first = await render("/boo-tique");
    const second = await render("/boo-tique");
    for (const id of ["home-fixed-date-sale", "home-rolling-midnight-text"]) {
      expect(textOf(first, id)).toBe(textOf(second, id));
    }
  });

  it("outputs the hero text 04:59:59 in every render", async () => {
    for (let i = 0; i < 3; i += 1) {
      const markup = await render("/boo-tique");
      expect(textOf(markup, "home-hero-countdown-restart")).toBe(
        "Boo-nanza ends in 04:59:59",
      );
    }
  });
});

describe("home page grid adds no unlisted manipulative copy", () => {
  it("shows no Selling fast text and no bt-badge element", async () => {
    const markup = await render("/boo-tique");
    expect(visibleText(markup)).not.toMatch(/selling fast/i);
    expect(markup).not.toContain("bt-badge");
  });
});

describe("home page variant query values", () => {
  it("gives the default markup for an unknown banner value", async () => {
    const base = await render("/boo-tique");
    expect(await render("/boo-tique?banner=foo")).toBe(base);
  });

  it("gives the default markup for an unknown modal value", async () => {
    const base = await render("/boo-tique");
    expect(await render("/boo-tique?modal=foo")).toBe(base);
  });

  it("treats a repeated banner key as its first value", async () => {
    const ghost = await render("/boo-tique?banner=ghost");
    expect(await render("/boo-tique?banner=ghost&banner=equal")).toBe(ghost);
  });

  it("does not throw for unknown and repeated values", async () => {
    await expect(
      render("/boo-tique?banner=foo&banner=ghost&modal=bar&modal=exit-intent"),
    ).resolves.toContain("Ghost Pepper Candle");
  });
});

// ---- Cookie banner variants (rendered through ROUTE_TABLE) ----

/** Opening tag of the first `<button>` or `<a>` whose text is exactly `label`. */
function controlTag(markup: string, tagName: "button" | "a", label: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>\\s*${label}\\s*</${tagName}>`);
  const match = re.exec(markup);
  if (!match) throw new Error(`No <${tagName}> labelled "${label}"`);
  return /^<[^>]*>/.exec(match[0])![0];
}

function bannerCount(markup: string): number {
  return (markup.match(/class="bt-banner"/g) ?? []).length;
}

function style(tag: string): string {
  const value = attr(tag, "style");
  if (value === undefined) throw new Error(`No style attribute on ${tag}`);
  return value;
}

const URGENCY_IDS = [
  "home-hero-countdown-restart",
  "home-rolling-midnight-text",
  "home-fixed-date-sale",
];

describe("default cookie banner", () => {
  it("has the entry id once on a bt-banner region", async () => {
    const markup = await renderRoute("/boo-tique");
    expect(countTestId(markup, "home-cookie-accept-dominant")).toBe(1);
    const tag = openTag(markup, "home-cookie-accept-dominant");
    expect(attr(tag, "class")).toBe("bt-banner");
    expect(attr(tag, "role")).toBe("region");
    expect(attr(tag, "aria-label")).toBe("Cookie preferences");
  });

  it("styles Accept all as the large filled button", async () => {
    const markup = await renderRoute("/boo-tique");
    const accept = style(controlTag(markup, "button", "Accept all"));
    for (const declaration of [
      "font-size:20px",
      "font-weight:700",
      "padding:16px 48px",
      "min-height:56px",
      "background:#8b1a1a",
      "color:#ffffff",
    ]) {
      expect(accept, declaration).toContain(declaration);
    }
  });

  it("has a small grey options link", async () => {
    const markup = await renderRoute("/boo-tique");
    const link = style(controlTag(markup, "a", "options"));
    expect(link).toContain("font-size:11px");
    expect(link).toContain("color:#9a9a9a");
  });

  it("has no Reject control", async () => {
    const markup = await renderRoute("/boo-tique");
    expect(markup).not.toContain("Reject");
    expect(markup).not.toContain("reject");
  });

  it("is the only cookie banner and sits in the initial HTML", async () => {
    const markup = await renderRoute("/boo-tique");
    expect(bannerCount(markup)).toBe(1);
  });

  it("keeps the urgency block", async () => {
    const markup = await renderRoute("/boo-tique");
    for (const id of URGENCY_IDS) expect(countTestId(markup, id), id).toBe(1);
  });
});

describe("ghost cookie banner", () => {
  it("has the entry id once on a bt-banner region", async () => {
    const markup = await renderRoute("/boo-tique?banner=ghost");
    expect(countTestId(markup, "home-cookie-ghost-reject")).toBe(1);
    expect(attr(openTag(markup, "home-cookie-ghost-reject"), "class")).toBe(
      "bt-banner",
    );
  });

  it("fades the Reject button", async () => {
    const markup = await renderRoute("/boo-tique?banner=ghost");
    const reject = style(controlTag(markup, "button", "Reject"));
    for (const declaration of [
      "font-size:14px",
      "color:#b3b3b3",
      "background:transparent",
      "border:1px solid #b3b3b3",
      "opacity:0.6",
    ]) {
      expect(reject, declaration).toContain(declaration);
    }
  });

  it("keeps the large Accept all button", async () => {
    const markup = await renderRoute("/boo-tique?banner=ghost");
    const accept = style(controlTag(markup, "button", "Accept all"));
    expect(accept).toContain("font-size:20px");
    expect(accept).toContain("background:#8b1a1a");
  });

  it("has no urgency element and no default banner id", async () => {
    const markup = await renderRoute("/boo-tique?banner=ghost");
    for (const id of URGENCY_IDS) expect(countTestId(markup, id), id).toBe(0);
    expect(countTestId(markup, "home-cookie-accept-dominant")).toBe(0);
    expect(countTestId(markup, "home-cookie-equal-buttons")).toBe(0);
  });

  it("is the only cookie banner", async () => {
    expect(bannerCount(await renderRoute("/boo-tique?banner=ghost"))).toBe(1);
  });
});

describe("equal cookie banner", () => {
  it("has the entry id once on a bt-banner region", async () => {
    const markup = await renderRoute("/boo-tique?banner=equal");
    expect(countTestId(markup, "home-cookie-equal-buttons")).toBe(1);
    expect(attr(openTag(markup, "home-cookie-equal-buttons"), "class")).toBe(
      "bt-banner",
    );
  });

  it("gives Accept and Reject identical style attributes", async () => {
    const markup = await renderRoute("/boo-tique?banner=equal");
    const accept = style(controlTag(markup, "button", "Accept all"));
    const reject = style(controlTag(markup, "button", "Reject all"));
    expect(accept).toBe(reject);
    expect(accept).toContain("min-width:160px");
  });

  it("has no urgency element and no other banner id", async () => {
    const markup = await renderRoute("/boo-tique?banner=equal");
    for (const id of URGENCY_IDS) expect(countTestId(markup, id), id).toBe(0);
    expect(countTestId(markup, "home-cookie-accept-dominant")).toBe(0);
    expect(countTestId(markup, "home-cookie-ghost-reject")).toBe(0);
  });

  it("is the only cookie banner", async () => {
    expect(bannerCount(await renderRoute("/boo-tique?banner=equal"))).toBe(1);
  });
});

describe("exit-intent newsletter modal", () => {
  const ROUTE = "/boo-tique?modal=exit-intent";

  it("has the partners checkbox once, checked", async () => {
    const markup = await renderRoute(ROUTE);
    expect(countTestId(markup, "newsletter-partners-prechecked")).toBe(1);
    const tag = openTag(markup, "newsletter-partners-prechecked");
    expect(tag.startsWith("<input")).toBe(true);
    expect(attr(tag, "type")).toBe("checkbox");
    expect(hasAttr(tag, "checked")).toBe(true);
  });

  it("labels the partners checkbox", async () => {
    const markup = await renderRoute(ROUTE);
    expect(visibleText(markup)).toContain("Share my details with trusted partners");
  });

  it("leaves the modal's own newsletter checkbox unchecked", async () => {
    const markup = await renderRoute(ROUTE);
    const tag = openTag(markup, "bt-exit-newsletter-optin");
    expect(attr(tag, "type")).toBe("checkbox");
    expect(hasAttr(tag, "checked")).toBe(false);
  });

  it("makes the dialog root a modal dialog that can take focus", async () => {
    const markup = await renderRoute(ROUTE);
    const tag = openTag(markup, "bt-exit-intent-dialog");
    expect(attr(tag, "role")).toBe("dialog");
    expect(attr(tag, "aria-modal")).toBe("true");
    expect(attr(tag, "tabindex")).toBe("-1");
    expect(attr(tag, "class")).toBe("bt-dialog");
    expect(attr(tag, "aria-label")).toBeTruthy();
  });

  it("renders a backdrop in the initial HTML", async () => {
    const markup = await renderRoute(ROUTE);
    expect(countTestId(markup, "bt-backdrop")).toBe(1);
    expect(attr(openTag(markup, "bt-backdrop"), "class")).toBe("bt-backdrop");
  });

  it("puts the partners checkbox inside the dialog", async () => {
    const markup = await renderRoute(ROUTE);
    const dialog = textOf(markup, "bt-exit-intent-dialog");
    expect(dialog).toContain("Share my details with trusted partners");
    const open = markup.indexOf('data-testid="bt-exit-intent-dialog"');
    const partners = markup.indexOf('data-testid="newsletter-partners-prechecked"');
    expect(partners).toBeGreaterThan(open);
  });

  it("gives Subscribe and Not now the same style attribute", async () => {
    const markup = await renderRoute(ROUTE);
    const subscribe = style(controlTag(markup, "button", "Subscribe"));
    const decline = style(controlTag(markup, "button", "Not now"));
    expect(decline).toBe(subscribe);
  });

  it("has a close button", async () => {
    const markup = await renderRoute(ROUTE);
    const close = /<button\b[^>]*aria-label="Close"[^>]*>/.exec(markup);
    expect(close).not.toBeNull();
    expect(attr(close![0], "type")).toBe("button");
  });

  it("has no cookie banner, no urgency element and no promo block", async () => {
    const markup = await renderRoute(ROUTE);
    expect(bannerCount(markup)).toBe(0);
    for (const id of [
      ...URGENCY_IDS,
      "home-cookie-accept-dominant",
      "home-cookie-ghost-reject",
      "home-cookie-equal-buttons",
    ]) {
      expect(countTestId(markup, id), id).toBe(0);
    }
  });

  it("has no text input", async () => {
    const markup = await renderRoute(ROUTE);
    const inputs = markup.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.length).toBe(2);
    for (const tag of inputs) expect(attr(tag, "type"), tag).toBe("checkbox");
    expect(markup).not.toContain("<textarea");
  });

  it("still shows the product grid", async () => {
    const markup = await renderRoute(ROUTE);
    expect(markup.split('data-testid="bt-product-card"').length - 1).toBe(6);
  });

  it("wins over a banner value", async () => {
    const markup = await renderRoute(`${ROUTE}&banner=ghost`);
    expect(bannerCount(markup)).toBe(0);
    expect(countTestId(markup, "newsletter-partners-prechecked")).toBe(1);
  });

  it("gives every button type=button", async () => {
    const markup = await renderRoute(ROUTE);
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const tag of buttons) expect(attr(tag, "type"), tag).toBe("button");
  });
});

describe("cookie banner buttons", () => {
  it.each(["/boo-tique", "/boo-tique?banner=ghost", "/boo-tique?banner=equal"])(
    "gives every button type=button on %s",
    async (route) => {
      const markup = await renderRoute(route);
      const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      for (const tag of buttons) expect(attr(tag, "type"), tag).toBe("button");
    },
  );
});
