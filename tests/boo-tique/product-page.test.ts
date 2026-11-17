import { describe, it, expect } from "vitest";
import { createProductPage } from "@/components/boo-tique/product-page";
import { renderRoute } from "./helpers/render-route";
import type { PageProps, RouteTableEntry } from "./helpers/route-table";
import {
  attr,
  countTestId,
  hasAttr,
  openTag,
  testIds,
  textOf,
  visibleText,
} from "./helpers/markup";

const ROUTE = "/boo-tique/product/ghost-pepper-candle";

/** Local one-entry table around the factory, with an injected random source. */
function tableFor(random: () => number): readonly RouteTableEntry[] {
  return [
    {
      pattern: "/boo-tique/product/[slug]",
      load: async () => {
        const page = createProductPage(random);
        return {
          // The harness passes params as Record<string, string>; the page wants { slug }.
          default: ({ params }: PageProps) =>
            page({ params: params.then((all) => ({ slug: all.slug })) }),
        };
      },
    },
  ];
}

function render(random: () => number = () => 0, route: string = ROUTE): Promise<string> {
  return renderRoute(route, { table: tableFor(random) });
}

const CONTENT_IDS = [
  "product-low-stock-random",
  "product-viewers-random",
  "product-selling-fast-badge",
  "product-almost-gone-tiny",
  "product-real-inventory-3-left",
] as const;

describe("product page entries", () => {
  it.each(CONTENT_IDS)("has %s exactly once", async (id) => {
    expect(countTestId(await render(), id)).toBe(1);
  });

  it("shows 'Only N left!' with the injected stock", async () => {
    // random 0 -> stock 2, viewers 8
    const low = await render(() => 0);
    expect(textOf(low, "product-low-stock-random")).toBe("Only 2 left!");
    // random 0.999999 -> stock 9, viewers 48
    const high = await render(() => 0.999999);
    expect(textOf(high, "product-low-stock-random")).toBe("Only 9 left!");
  });

  it("shows 'N people are viewing this' with the injected viewers", async () => {
    const low = await render(() => 0);
    expect(textOf(low, "product-viewers-random")).toBe("8 people are viewing this");
    const high = await render(() => 0.999999);
    expect(textOf(high, "product-viewers-random")).toBe("48 people are viewing this");
  });

  it("renders different markup for different injected sources", async () => {
    expect(await render(() => 0)).not.toBe(await render(() => 0.999999));
  });

  it("renders the same markup for the same source", async () => {
    expect(await render(() => 0.4)).toBe(await render(() => 0.4));
  });

  it("contains each generated number in the markup", async () => {
    // 0.5 -> stock 2 + 4 = 6, viewers 8 + floor(0.5 * 41) = 28
    const markup = await render(() => 0.5);
    expect(textOf(markup, "product-low-stock-random")).toContain("6");
    expect(textOf(markup, "product-viewers-random")).toContain("28");
  });

  it("shows 'Selling fast' with no digit", async () => {
    const text = textOf(await render(), "product-selling-fast-badge");
    expect(text).toBe("Selling fast");
    expect(text).not.toMatch(/\d/);
  });

  it("shows 'Almost gone' at 10px in grey with a data-stock-label", async () => {
    const markup = await render();
    expect(textOf(markup, "product-almost-gone-tiny")).toBe("Almost gone");
    const tag = openTag(markup, "product-almost-gone-tiny");
    expect(tag.startsWith("<span")).toBe(true);
    expect(attr(tag, "style")).toContain("font-size:10px");
    expect(attr(tag, "style")).toContain("color:#9a9a9a");
    expect(hasAttr(tag, "data-stock-label")).toBe(true);
    expect(attr(tag, "data-stock-label")).toBe("Almost gone");
  });
});

describe("real inventory look-alike", () => {
  it("shows '3 left' on a span", async () => {
    const markup = await render();
    expect(openTag(markup, "product-real-inventory-3-left").startsWith("<span")).toBe(true);
    expect(textOf(markup, "product-real-inventory-3-left")).toBe("3 left");
  });

  it("puts '3 left' in the Travel tin row", async () => {
    const markup = await render();
    expect(textOf(markup, "bt-variant-travel-tin")).toContain("Travel tin");
    expect(textOf(markup, "bt-variant-travel-tin")).toContain("3 left");
    expect(textOf(markup, "bt-variant-large-jar")).toContain("Large jar");
    expect(textOf(markup, "bt-variant-large-jar")).not.toContain("left");
  });

  it("has no urgency wording in the Travel tin row besides the count", async () => {
    const row = textOf(await render(), "bt-variant-travel-tin").toLowerCase();
    for (const word of ["only", "hurry", "last", "almost", "selling", "fast", "!"]) {
      expect(row, word).not.toContain(word);
    }
  });

  it("does not depend on the injected random source", async () => {
    const a = textOf(await render(() => 0), "product-real-inventory-3-left");
    const b = textOf(await render(() => 0.999999), "product-real-inventory-3-left");
    expect(a).toBe(b);
  });
});

const OVERLAY_IDS = ["product-sold-toast", "product-upsell-modal-tiny-close"] as const;

/** Opening tags of every button in the markup. */
function buttonTags(markup: string): string[] {
  return markup.match(/<button\b[^>]*>/g) ?? [];
}

describe("sold toast", () => {
  it("is present once in the initial HTML", async () => {
    expect(countTestId(await render(), "product-sold-toast")).toBe(1);
  });

  it("is a role=status element with the bt-toast class", async () => {
    const tag = openTag(await render(), "product-sold-toast");
    expect(attr(tag, "role")).toBe("status");
    expect((attr(tag, "class") ?? "").split(/\s+/)).toContain("bt-toast");
  });

  it("shows the first message first", async () => {
    const text = textOf(await render(), "product-sold-toast");
    expect(text).toContain("Morgan from Ohio just bought the Cursed Candle Set");
  });

  it("has a dismiss button of type button", async () => {
    const markup = await render();
    const dismiss = buttonTags(markup).filter((tag) => attr(tag, "aria-label") === "Dismiss");
    expect(dismiss).toHaveLength(1);
    expect(attr(dismiss[0], "type")).toBe("button");
  });

  it("is the same markup for any injected random source", async () => {
    const a = textOf(await render(() => 0), "product-sold-toast");
    const b = textOf(await render(() => 0.999999), "product-sold-toast");
    expect(a).toBe(b);
  });
});

describe("upsell dialog", () => {
  it("is present once in the initial HTML", async () => {
    expect(countTestId(await render(), "product-upsell-modal-tiny-close")).toBe(1);
  });

  it("is an open modal dialog with tabindex -1", async () => {
    const tag = openTag(await render(), "product-upsell-modal-tiny-close");
    expect(tag.startsWith("<section")).toBe(true);
    expect(attr(tag, "role")).toBe("dialog");
    expect(attr(tag, "aria-modal")).toBe("true");
    expect(attr(tag, "tabindex")).toBe("-1");
    expect(attr(tag, "aria-label")).toBe("Bundle offer");
  });

  it("has a backdrop", async () => {
    const markup = await render();
    expect(countTestId(markup, "bt-backdrop")).toBe(1);
    expect(attr(openTag(markup, "bt-backdrop"), "class")).toContain("bt-backdrop");
  });

  it("has a large full-width 'Add crypt keeper bundle' button", async () => {
    const markup = await render();
    const buttons = (markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).filter((button) =>
      button.includes("Add crypt keeper bundle"),
    );
    expect(buttons).toHaveLength(1);
    const style = attr(buttons[0], "style") ?? "";
    expect(attr(buttons[0], "type")).toBe("button");
    expect(style).toContain("font-size:20px");
    expect(style).toContain("font-weight:700");
    expect(style).toContain("width:100%");
  });

  it("has a tiny 'x' close button", async () => {
    const markup = await render();
    const closes = (markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).filter(
      (button) => attr(button, "aria-label") === "Close",
    );
    expect(closes).toHaveLength(1);
    const style = attr(closes[0], "style") ?? "";
    expect(attr(closes[0], "type")).toBe("button");
    expect(closes[0].replace(/<[^>]*>/g, "")).toBe("x");
    expect(style).toContain("font-size:8px");
    expect(style).toContain("color:#cfc6bc");
  });

  it("sits inside the dialog, after the backdrop", async () => {
    const markup = await render();
    const backdrop = markup.indexOf('data-testid="bt-backdrop"');
    const dialog = markup.indexOf('data-testid="product-upsell-modal-tiny-close"');
    const close = markup.indexOf('aria-label="Close"');
    expect(backdrop).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(backdrop);
    expect(close).toBeGreaterThan(dialog);
  });
});

describe("overlays on the product page", () => {
  it("has exactly one dialog, one status toast and one backdrop", async () => {
    const markup = await render();
    expect(markup.split('role="dialog"').length - 1).toBe(1);
    expect(markup.split('role="status"').length - 1).toBe(1);
    expect(countTestId(markup, "bt-backdrop")).toBe(1);
    expect(markup).not.toContain("bt-banner");
  });

  it("does not render the overlays for an unknown slug", async () => {
    const markup = await render(() => 0, "/boo-tique/product/some-other-thing");
    for (const id of OVERLAY_IDS) expect(countTestId(markup, id), id).toBe(0);
    expect(markup).not.toContain("bt-backdrop");
  });
});

describe("product page content", () => {
  it("shows the product name and price", async () => {
    const markup = await render();
    expect(markup).toContain("Ghost Pepper Candle");
    expect(markup).toContain('<p class="bt-price">$18.00</p>');
  });

  it("renders the candle tile, one h1 and a star rating with a role", async () => {
    const markup = await render();
    expect(markup).toContain('<div class="bt-tile bt-tile--candle" aria-hidden="true">');
    const h1s = markup.match(/<h1\b[^>]*>[^<]*<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.replace(/<[^>]*>/g, "")).toBe("Ghost Pepper Candle");
    expect(markup).toContain(
      '<p class="bt-muted" role="img" aria-label="Rated 5 out of 5">',
    );
  });

  it("keeps the 'Only N left!' text with the injected value", async () => {
    // draw 0.5 -> STOCK_VALUES[floor(0.5 * 7)] = 6
    const markup = await render(() => 0.5);
    expect(textOf(markup, "product-low-stock-random")).toBe("Only 6 left!");
  });

  it("has an inert 'Add to cart' button of type button", async () => {
    const markup = await render();
    const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    const add = buttons.filter((button) => button.includes("Add to cart"));
    expect(add).toHaveLength(1);
    expect(attr(add[0], "type")).toBe("button");
    expect(add[0]).not.toContain("onclick");
  });

  it("gives every button type=button", async () => {
    const markup = await render();
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const tag of buttons) expect(attr(tag, "type"), tag).toBe("button");
  });

  it("uses no img, form or input", async () => {
    const markup = await render();
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<input");
  });

  it("carries no other entry id, and every extra test id starts with bt-", async () => {
    const ids = testIds(await render());
    for (const id of ids) {
      if (!(CONTENT_IDS as readonly string[]).includes(id) && !(OVERLAY_IDS as readonly string[]).includes(id)) {
        expect(id.startsWith("bt-"), id).toBe(true);
      }
    }
  });

  it("has no stock, viewer or urgency copy outside the planted elements", async () => {
    const text = visibleText(await render(() => 0), {
      exclude: [...CONTENT_IDS, ...OVERLAY_IDS, "bt-variant-travel-tin"],
    }).toLowerCase();
    for (const word of ["left", "viewing", "selling", "hurry", "ends", "gone", "sold"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("has no cookie banner", async () => {
    expect(await render()).not.toContain("bt-banner");
  });
});

describe("unknown slug", () => {
  const unknown = "/boo-tique/product/some-other-thing";

  it("shows the 'not available in this demo' message", async () => {
    const markup = await render(() => 0, unknown);
    expect(visibleText(markup)).toContain("not available in this demo");
  });

  it("contains no entry id and no per-load numbers", async () => {
    const markup = await render(() => 0, unknown);
    for (const id of CONTENT_IDS) expect(countTestId(markup, id), id).toBe(0);
    expect(markup).not.toContain("people are viewing");
  });

  it("does not throw for odd slugs", async () => {
    await expect(render(() => 0, "/boo-tique/product/%E0%A4%A")).resolves.toContain(
      "not available in this demo",
    );
  });
});
