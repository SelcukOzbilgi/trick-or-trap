import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, visibleText } from "./helpers/markup";
import { formatUsd, summaryRows } from "@/lib/boo-tique/cart";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/checkout", load: () => import("@/app/boo-tique/checkout/page") },
];

const DEFAULT_ROUTE = "/boo-tique/checkout";
const HONEST_ROUTE = "/boo-tique/checkout?flow=honest";
const DRIP_ID = "checkout-handling-fees-drip";
const HONEST_ID = "checkout-consistent-shipping-tax";
const WORDS = ["handling", "haunting", "phone"];

function render(route: string): Promise<string> {
  return renderRoute(route, { table: TABLE });
}

/** Raw markup of the `<dl>` that carries the test id. */
function listMarkup(markup: string, id: string): string {
  const idx = markup.indexOf(`data-testid="${id}"`);
  expect(idx, id).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<dl", idx);
  const end = markup.indexOf("</dl>", idx);
  expect(start, `<dl> around ${id}`).toBeGreaterThan(-1);
  return markup.slice(start, end + "</dl>".length);
}

/** Attribute names of an opening tag, in order. */
function attrNames(tag: string): string[] {
  const nameEnd = /^<[a-zA-Z][a-zA-Z0-9-]*/.exec(tag);
  const rest = nameEnd ? tag.slice(nameEnd[0].length) : tag;
  return [...rest.matchAll(/\s([^\s=/>"']+)(?:="[^"]*")?/g)].map((m) => m[1]);
}

function rowLabels(list: string): string[] {
  return [...list.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
}

function rowHtml(label: string, price: string): string {
  return `<div class="bt-variant-row"><dt>${label}</dt><dd class="bt-price">${price}</dd></div>`;
}

function expectPlaceOrder(markup: string): void {
  const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
  expect(buttons).toHaveLength(1);
  const button = buttons[0] ?? "";
  expect(attr(button, "type")).toBe("button");
  expect(hasAttr(button, "disabled")).toBe(true);
  expect(attr(button, "class")).toBe("bt-button");
  expect(button).toContain(">Place order</button>");
}

describe("checkout page default view", () => {
  it("has checkout-newsletter-prechecked as a checked checkbox labelled for the Boo-letter", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, "checkout-newsletter-prechecked")).toBe(1);
    const tag = openTag(markup, "checkout-newsletter-prechecked");
    expect(tag.startsWith("<input")).toBe(true);
    expect(attr(tag, "type")).toBe("checkbox");
    expect(hasAttr(tag, "checked")).toBe(true);
    const idx = markup.indexOf('data-testid="checkout-newsletter-prechecked"');
    const start = markup.lastIndexOf("<label", idx);
    const end = markup.indexOf("</label>", idx);
    const label = markup.slice(start, end).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    expect(label).toBe("Send me the Boo-letter");
  });

  it("has checkout-handling-fees-drip once, on a <dl class=bt-list>", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, DRIP_ID)).toBe(1);
    const tag = openTag(markup, DRIP_ID);
    expect(tag.startsWith("<dl")).toBe(true);
    expect(attr(tag, "class")).toBe("bt-list");
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("lists Items, Extras, Shipping, Insurance, Tax, Handling, Haunting fee, Total in order", async () => {
    const list = listMarkup(await render(DEFAULT_ROUTE), DRIP_ID);
    expect(rowLabels(list)).toEqual([
      "Items",
      "Extras",
      "Shipping",
      "Insurance",
      "Tax",
      "Handling",
      "Haunting fee",
      "Total",
    ]);
  });

  it("renders the two fees as ordinary summary rows", async () => {
    const list = listMarkup(await render(DEFAULT_ROUTE), DRIP_ID);
    expect(list).toContain(rowHtml("Handling", "$6.99"));
    expect(list).toContain(rowHtml("Haunting fee", "$3.00"));
  });

  it("has no link, button or input inside the summary list", async () => {
    const list = listMarkup(await render(DEFAULT_ROUTE), DRIP_ID);
    expect(list).not.toContain("<a ");
    expect(list).not.toContain("<a>");
    expect(list).not.toContain("<button");
    expect(list).not.toContain("<input");
  });

  it("has the rows of summaryRows(checkout-default) and Total $77.68", async () => {
    const list = listMarkup(await render(DEFAULT_ROUTE), DRIP_ID);
    for (const row of summaryRows("checkout-default")) {
      expect(list).toContain(rowHtml(row.label, formatUsd(row.cents)));
    }
    expect(visibleText(list)).toContain("Total $77.68");
  });

  it("has a disabled place-order button of type button with the bt-button class", async () => {
    expectPlaceOrder(await render(DEFAULT_ROUTE));
  });

  it("has no input other than the newsletter checkbox", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const inputs = markup.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(attr(inputs[0] ?? "", "data-testid")).toBe("checkout-newsletter-prechecked");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<textarea");
  });

  it("has none of handling, haunting or phone outside the summary list", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE), { exclude: [DRIP_ID] }).toLowerCase();
    for (const word of WORDS) expect(text, word).not.toContain(word);
  });

  it("does not contain the honest summary", async () => {
    expect(countTestId(await render(DEFAULT_ROUTE), HONEST_ID)).toBe(0);
  });

  it("is deterministic across renders", async () => {
    expect(await render(DEFAULT_ROUTE)).toBe(await render(DEFAULT_ROUTE));
  });
});

describe("checkout page honest view", () => {
  it("has checkout-consistent-shipping-tax once, on a visible <dl class=bt-list>", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, HONEST_ID)).toBe(1);
    const tag = openTag(markup, HONEST_ID);
    expect(tag.startsWith("<dl")).toBe(true);
    expect(attr(tag, "class")).toBe("bt-list");
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("has the rows of summaryRows(checkout-honest) and Total $67.69", async () => {
    const list = listMarkup(await render(HONEST_ROUTE), HONEST_ID);
    const rows = summaryRows("checkout-honest");
    expect(rowLabels(list)).toEqual(rows.map((r) => r.label));
    for (const row of rows) {
      expect(list).toContain(rowHtml(row.label, formatUsd(row.cents)));
    }
    expect(visibleText(list)).toContain("Total $67.69");
  });

  it("has no link, button or input inside the summary list", async () => {
    const list = listMarkup(await render(HONEST_ROUTE), HONEST_ID);
    expect(list).not.toContain("<a ");
    expect(list).not.toContain("<button");
    expect(list).not.toContain("<input");
  });

  it("has no checked control and no input", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("checked");
    expect(markup).not.toContain('aria-checked="true"');
  });

  it("has no fee entry and no newsletter entry", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, DRIP_ID)).toBe(0);
    expect(countTestId(markup, "checkout-newsletter-prechecked")).toBe(0);
    expect(markup).not.toContain("phase-2");
  });

  it("has none of handling, haunting or phone anywhere in its visible text", async () => {
    const text = visibleText(await render(HONEST_ROUTE)).toLowerCase();
    for (const word of WORDS) expect(text, word).not.toContain(word);
  });

  it("has a disabled place-order button of type button with the bt-button class", async () => {
    expectPlaceOrder(await render(HONEST_ROUTE));
  });
});

describe("checkout summary list tags", () => {
  it("gives both summary lists the same attribute names and no other data- attribute", async () => {
    const honestTag = openTag(await render(HONEST_ROUTE), HONEST_ID);
    const defaultTag = openTag(await render(DEFAULT_ROUTE), DRIP_ID);
    expect(attrNames(honestTag)).toEqual(["class", "data-testid"]);
    expect(attrNames(defaultTag)).toEqual(attrNames(honestTag));
    for (const name of attrNames(defaultTag)) {
      if (name.startsWith("data-")) expect(name).toBe("data-testid");
    }
  });

  it("has no data- attribute inside either summary list", async () => {
    for (const [route, id] of [
      [HONEST_ROUTE, HONEST_ID],
      [DEFAULT_ROUTE, DRIP_ID],
    ] as const) {
      const list = listMarkup(await render(route), id);
      const inner = list.slice(list.indexOf(">") + 1);
      expect(inner, id).not.toMatch(/\sdata-/);
    }
  });
});

describe("checkout page variants", () => {
  it("renders the default markup for an unknown flow value", async () => {
    expect(await render("/boo-tique/checkout?flow=foo")).toBe(await render(DEFAULT_ROUTE));
  });

  it("uses the first value of a repeated flow key", async () => {
    const markup = await render("/boo-tique/checkout?flow=honest&flow=default");
    expect(countTestId(markup, HONEST_ID)).toBe(1);
    const fallback = await render("/boo-tique/checkout?flow=foo&flow=honest");
    expect(fallback).toBe(await render(DEFAULT_ROUTE));
  });

  it("has no overlay on either view", async () => {
    for (const route of [DEFAULT_ROUTE, HONEST_ROUTE]) {
      const markup = await render(route);
      expect(markup).not.toContain("bt-banner");
      expect(markup).not.toContain("bt-dialog");
      expect(markup).not.toContain("bt-toast");
    }
  });
});
