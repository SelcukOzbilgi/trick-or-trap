import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { countTestId, textOf, visibleText } from "./helpers/markup";

/** Local one-entry table: the home page is not in ROUTE_TABLE until task 6. */
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
      "Halloween sale ends 31 Oct 2026, 23:59 UTC",
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
