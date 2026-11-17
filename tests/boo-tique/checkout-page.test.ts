import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, textOf, visibleText } from "./helpers/markup";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/checkout", load: () => import("@/app/boo-tique/checkout/page") },
];

const DEFAULT_ROUTE = "/boo-tique/checkout";
const HONEST_ROUTE = "/boo-tique/checkout?flow=honest";
const PREVIEW_ID = "checkout-handling-fees-drip";
const HONEST_ID = "checkout-consistent-shipping-tax";
const PREVIEW_LABEL = "Static preview of a later flow";
const WORDS = ["insurance", "handling", "haunting", "phone"];

function render(route: string): Promise<string> {
  return renderRoute(route, { table: TABLE });
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

  it("has checkout-handling-fees-drip once, as a visible <li> with both fees and the label", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, PREVIEW_ID)).toBe(1);
    const tag = openTag(markup, PREVIEW_ID);
    expect(tag.startsWith("<li")).toBe(true);
    expect(attr(tag, "data-anchor")).toBe("phase-2");
    expect(hasAttr(tag, "hidden")).toBe(false);
    const text = textOf(markup, PREVIEW_ID);
    expect(text).toContain("Handling $6.99");
    expect(text).toContain("Haunting fee $3.00");
    expect(text).toContain(PREVIEW_LABEL);
  });

  it("has no link, button or input inside the preview", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const idx = markup.indexOf(`data-testid="${PREVIEW_ID}"`);
    const start = markup.lastIndexOf("<li", idx);
    const end = markup.indexOf("</li>", idx);
    const preview = markup.slice(start, end);
    expect(preview).not.toContain("<a ");
    expect(preview).not.toContain("<button");
    expect(preview).not.toContain("<input");
  });

  it("shows Items $40.00 before the preview and Total $49.99 after it", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE));
    const items = text.indexOf("Items $40.00");
    const preview = text.indexOf("Handling $6.99");
    const total = text.indexOf("Total $49.99");
    expect(items).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(items);
    expect(total).toBeGreaterThan(preview);
  });

  it("puts the items line, the preview and the total in one list", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const idx = markup.indexOf(`data-testid="${PREVIEW_ID}"`);
    const listStart = markup.lastIndexOf("<ul", idx);
    const listEnd = markup.indexOf("</ul>", idx);
    const list = markup.slice(listStart, listEnd);
    expect(list).toContain("Items $40.00");
    expect(list).toContain("Total $49.99");
  });

  it("has a disabled place-order button of type button", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    const button = buttons[0] ?? "";
    expect(attr(button, "type")).toBe("button");
    expect(hasAttr(button, "disabled")).toBe(true);
    expect(visibleText(markup)).toContain("Place order");
  });

  it("has no input other than the newsletter checkbox", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const inputs = markup.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(attr(inputs[0] ?? "", "data-testid")).toBe("checkout-newsletter-prechecked");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<textarea");
  });

  it("has none of insurance, handling, haunting or phone outside the preview", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE), { exclude: [PREVIEW_ID] }).toLowerCase();
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
  it("has checkout-consistent-shipping-tax once, as a visible <dl>", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, HONEST_ID)).toBe(1);
    const tag = openTag(markup, HONEST_ID);
    expect(tag.startsWith("<dl")).toBe(true);
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("shows items $40.00, shipping $4.00, tax $3.20 and total $47.20 in the summary", async () => {
    const text = textOf(await render(HONEST_ROUTE), HONEST_ID);
    expect(text).toContain("Items $40.00");
    expect(text).toContain("Shipping $4.00");
    expect(text).toContain("Tax $3.20");
    expect(text).toContain("Total $47.20");
  });

  it("has no checked control and no input", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("checked");
    expect(markup).not.toContain('aria-checked="true"');
  });

  it("has no phase-2 preview and no newsletter entry", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, PREVIEW_ID)).toBe(0);
    expect(countTestId(markup, "checkout-newsletter-prechecked")).toBe(0);
    expect(markup).not.toContain("phase-2");
  });

  it("has none of insurance, handling, haunting or phone anywhere in its visible text", async () => {
    const text = visibleText(await render(HONEST_ROUTE)).toLowerCase();
    for (const word of WORDS) expect(text, word).not.toContain(word);
  });

  it("gives every button type=button", async () => {
    const markup = await render(HONEST_ROUTE);
    for (const tag of markup.match(/<button\b[^>]*>/g) ?? []) {
      expect(attr(tag, "type"), tag).toBe("button");
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
