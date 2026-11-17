import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, visibleText } from "./helpers/markup";
import {
  CART,
  CART_OPTIONS,
  addOnLabel,
  formatUsd,
  plainLabel,
  summaryRows,
} from "@/lib/boo-tique/cart";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/cart", load: () => import("@/app/boo-tique/cart/page") },
];

const ROUTE = "/boo-tique/cart";
const INSURANCE_ID = "cart-insurance-sneaked";

function render(): Promise<string> {
  return renderRoute(ROUTE, { table: TABLE });
}

/** Text of the `<label>` that wraps the control carrying the test id. */
function labelText(markup: string, id: string): string {
  const idx = markup.indexOf(`data-testid="${id}"`);
  expect(idx, id).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<label", idx);
  const end = markup.indexOf("</label>", idx);
  expect(start, `label around ${id}`).toBeGreaterThan(-1);
  expect(end, `label around ${id}`).toBeGreaterThan(idx);
  return markup
    .slice(start, end)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isChecked(markup: string, id: string): boolean {
  return hasAttr(openTag(markup, id), "checked");
}

/** Attribute names of an opening tag, in order. */
function attrNames(tag: string): string[] {
  const nameEnd = /^<[a-zA-Z][a-zA-Z0-9-]*/.exec(tag);
  const rest = nameEnd ? tag.slice(nameEnd[0].length) : tag;
  return [...rest.matchAll(/\s([^\s=/>"']+)(?:="[^"]*")?/g)].map((m) => m[1]);
}

/** The `<li class="bt-line-row"...>` elements of the cart lines list, as raw markup. */
function lineItems(markup: string): string[] {
  return markup.match(/<li\b[^>]*class="bt-line-row"[^>]*>.*?<\/li>/g) ?? [];
}

/** Rows of the summary `<dl>`: label and price text. */
function summaryRowTexts(markup: string): { label: string; price: string }[] {
  const start = markup.indexOf('<dl class="bt-list" data-testid="bt-cart-summary">');
  expect(start, "summary dl").toBeGreaterThan(-1);
  const end = markup.indexOf("</dl>", start);
  const dl = markup.slice(start, end);
  return [...dl.matchAll(/<dt>([^<]*)<\/dt><dd class="bt-price">([^<]*)<\/dd>/g)].map((m) => ({
    label: m[1],
    price: m[2],
  }));
}

describe("cart page lines", () => {
  it("lists three bt-line-row items: candle, mug, insurance, with their prices", async () => {
    const items = lineItems(await render());
    expect(items).toHaveLength(3);
    const expected = [
      ["Ghost Pepper Candle", "$18.00"],
      ["Moon-Phase Mug", "$22.00"],
      ["Insurance", "$4.00"],
    ];
    items.forEach((item, i) => {
      expect(item.startsWith("<li "), item).toBe(true);
      expect(item, item).toContain(`<span>${expected[i][0]}</span>`);
      expect(item, item).toContain(`<span class="bt-price">${expected[i][1]}</span>`);
    });
    expect(CART.lines.map((l) => formatUsd(l.cents))).toEqual(["$18.00", "$22.00"]);
  });

  it("puts cart-insurance-sneaked once on the third line", async () => {
    const markup = await render();
    expect(countTestId(markup, INSURANCE_ID)).toBe(1);
    const items = lineItems(markup);
    expect(items[2]).toContain(`data-testid="${INSURANCE_ID}"`);
    expect(items[0]).not.toContain("data-testid");
    expect(items[1]).not.toContain("data-testid");
    expect(openTag(markup, INSURANCE_ID).startsWith("<li")).toBe(true);
  });

  it("gives each line a span, a price span and an inert Remove button", async () => {
    const items = lineItems(await render());
    const names = ["Ghost Pepper Candle", "Moon-Phase Mug", "Insurance"];
    items.forEach((item, i) => {
      expect(item.toLowerCase(), item).not.toContain("onclick");
      const buttons = item.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
      expect(buttons, item).toHaveLength(1);
      const tag = /<button\b[^>]*>/.exec(item)?.[0] ?? "";
      expect(attr(tag, "type")).toBe("button");
      expect(attr(tag, "class")).toBe("bt-button bt-button--quiet");
      expect(attr(tag, "aria-label")).toBe(`Remove ${names[i]}`);
      expect((buttons[0] ?? "").endsWith(">Remove</button>")).toBe(true);
      const childTags = [...item.matchAll(/<(span|button)\b/g)].map((m) => m[1]);
      expect(childTags, item).toEqual(["span", "span", "button"]);
    });
  });

  it("gives the insurance line the attribute names of the candle line plus data-testid", async () => {
    const items = lineItems(await render());
    const open = (item: string) => /^<li\b[^>]*>/.exec(item)?.[0] ?? "";
    expect([...attrNames(open(items[2]))].sort()).toEqual(
      [...attrNames(open(items[0])), "data-testid"].sort(),
    );
  });

  it("gives the insurance line and its content no data- attribute except its data-testid", async () => {
    const items = lineItems(await render());
    const found = [...items[2].matchAll(/\sdata-[a-z0-9-]+/g)].map((m) => m[0].trim());
    expect(found).toEqual(["data-testid"]);
  });
});

describe("cart page summary", () => {
  it("renders the cart summary rows from summaryRows as '<label> <price>'", async () => {
    const markup = await render();
    const rows = summaryRowTexts(markup);
    const expected = summaryRows("cart").map((row) => ({
      label: row.label,
      price: formatUsd(row.cents),
    }));
    expect(rows).toEqual(expected);
    expect(rows.map((r) => `${r.label} ${r.price}`)).toEqual([
      "Items $40.00",
      "Extras $16.49",
      "Shipping $4.00",
      "Insurance $4.00",
      "Estimated tax $3.20",
      "Total $67.69",
    ]);
    const text = visibleText(markup);
    expect(text).toContain("Total $67.69");
    expect(text).toContain("Items $40.00");
    expect(text).toContain("Estimated tax $3.20");
  });

  it("puts the summary in a card headed Summary", async () => {
    const markup = await render();
    expect(markup).toContain('<h2 id="bt-cart-summary-heading">Summary</h2>');
  });

  it("has the Checkout link inside the summary card after the dl", async () => {
    const markup = await render();
    const cardStart = markup.indexOf('aria-labelledby="bt-cart-summary-heading"');
    expect(cardStart).toBeGreaterThan(-1);
    const cardEnd = markup.indexOf("</section>", cardStart);
    const card = markup.slice(cardStart, cardEnd);
    const link = '<a class="bt-button" href="/boo-tique/checkout">Checkout</a>';
    expect(card).toContain(link);
    expect(card.indexOf(link)).toBeGreaterThan(card.indexOf("</dl>"));
  });

  it("is deterministic across renders", async () => {
    expect(await render()).toBe(await render());
  });
});

describe("cart page extras", () => {
  it("uses the exact labels of the shared source", async () => {
    const markup = await render();
    const checks: [string, string][] = [
      ["cart-protection-prechecked", addOnLabel(CART_OPTIONS.protection)],
      ["cart-gift-wrap-unchecked", addOnLabel(CART_OPTIONS.giftWrap)],
      ["bt-cart-warranty-none", addOnLabel(CART_OPTIONS.warranty[0])],
      ["bt-cart-warranty-silver", addOnLabel(CART_OPTIONS.warranty[1])],
      ["cart-warranty-radio-preselected", addOnLabel(CART_OPTIONS.warranty[2])],
      ["cart-cheapest-shipping-default", plainLabel(CART_OPTIONS.shipping[0])],
      ["bt-cart-shipping-express", plainLabel(CART_OPTIONS.shipping[1])],
      ["bt-cart-shipping-overnight", plainLabel(CART_OPTIONS.shipping[2])],
    ];
    for (const [id, label] of checks) expect(labelText(markup, id), id).toBe(label);
    const packaging = new RegExp('id="bt-cart-packaging-label">([^<]*)<').exec(markup);
    expect(packaging?.[1]).toBe(addOnLabel(CART_OPTIONS.packaging));
  });

  it("renders every checkbox and radio as a bt-choice-row label with the input first", async () => {
    const markup = await render();
    const labels = markup.match(/<label\b[^>]*>/g) ?? [];
    expect(labels).toHaveLength(8);
    for (const tag of labels) expect(attr(tag, "class"), tag).toBe("bt-choice-row");
    for (const row of markup.match(/<label\b[^>]*>.*?<\/label>/g) ?? []) {
      expect(/^<label\b[^>]*><input\b[^>]*><span>[^<]*<\/span><\/label>$/.test(row), row).toBe(
        true,
      );
    }
  });

  it("renders the packaging row as a div with the label span before the switch", async () => {
    const markup = await render();
    const start = markup.indexOf('<div class="bt-choice-row">');
    expect(start).toBeGreaterThan(-1);
    const end = markup.indexOf("</div>", start);
    const row = markup.slice(start, end);
    const labelAt = row.indexOf('<span id="bt-cart-packaging-label">');
    const buttonAt = row.indexOf("<button");
    expect(labelAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(labelAt);
    expect(row).toContain('<span class="bt-toggle-knob"></span>');
  });

  it("has cart-protection-prechecked as a checked checkbox", async () => {
    const markup = await render();
    expect(countTestId(markup, "cart-protection-prechecked")).toBe(1);
    const tag = openTag(markup, "cart-protection-prechecked");
    expect(attr(tag, "type")).toBe("checkbox");
    expect(hasAttr(tag, "checked")).toBe(true);
    expect(labelText(markup, "cart-protection-prechecked")).toBe(
      "Add Raven Shipping Protection +$4.99",
    );
  });

  it("has cart-warranty-radio-preselected as the checked Gold radio with a cheaper radio in the group", async () => {
    const markup = await render();
    expect(countTestId(markup, "cart-warranty-radio-preselected")).toBe(1);
    const gold = openTag(markup, "cart-warranty-radio-preselected");
    expect(attr(gold, "type")).toBe("radio");
    expect(hasAttr(gold, "checked")).toBe(true);
    expect(labelText(markup, "cart-warranty-radio-preselected")).toContain(
      "Gold Extended Curse Warranty",
    );
    const group = attr(gold, "name");
    expect(group).toBeTruthy();

    for (const id of ["bt-cart-warranty-none", "bt-cart-warranty-silver"]) {
      const tag = openTag(markup, id);
      expect(attr(tag, "type"), id).toBe("radio");
      expect(attr(tag, "name"), id).toBe(group);
      expect(hasAttr(tag, "checked"), id).toBe(false);
    }
  });

  it("has cart-packaging-switch-on as a switch button with aria-checked=true", async () => {
    const markup = await render();
    expect(countTestId(markup, "cart-packaging-switch-on")).toBe(1);
    const tag = openTag(markup, "cart-packaging-switch-on");
    expect(tag.startsWith("<button")).toBe(true);
    expect(attr(tag, "role")).toBe("switch");
    expect(attr(tag, "aria-checked")).toBe("true");
    expect(attr(tag, "type")).toBe("button");
    expect(attr(tag, "class")).toBe("bt-toggle");
    const labelId = attr(tag, "aria-labelledby");
    expect(labelId).toBe("bt-cart-packaging-label");
    const labelMatch = new RegExp(`id="${labelId}"[^>]*>([^<]*)<`).exec(markup);
    expect(labelMatch?.[1]).toBe("Priority coffin packaging +$2.50");
  });

  it("has cart-gift-wrap-unchecked as an unchecked checkbox", async () => {
    const markup = await render();
    expect(countTestId(markup, "cart-gift-wrap-unchecked")).toBe(1);
    const tag = openTag(markup, "cart-gift-wrap-unchecked");
    expect(attr(tag, "type")).toBe("checkbox");
    expect(hasAttr(tag, "checked")).toBe(false);
    expect(labelText(markup, "cart-gift-wrap-unchecked")).toBe("Gift wrap +$2.00");
  });

  it("has cart-cheapest-shipping-default as the checked $4.00 radio, with two dearer radios unchecked", async () => {
    const markup = await render();
    expect(countTestId(markup, "cart-cheapest-shipping-default")).toBe(1);
    const cheapest = openTag(markup, "cart-cheapest-shipping-default");
    expect(attr(cheapest, "type")).toBe("radio");
    expect(hasAttr(cheapest, "checked")).toBe(true);
    expect(labelText(markup, "cart-cheapest-shipping-default")).toBe(
      "Standard coffin post $4.00",
    );
    const group = attr(cheapest, "name");
    expect(group).toBeTruthy();

    for (const id of ["bt-cart-shipping-express", "bt-cart-shipping-overnight"]) {
      const tag = openTag(markup, id);
      expect(attr(tag, "type"), id).toBe("radio");
      expect(attr(tag, "name"), id).toBe(group);
      expect(hasAttr(tag, "checked"), id).toBe(false);
    }
    expect(labelText(markup, "bt-cart-shipping-express")).toContain("$9.00");
    expect(labelText(markup, "bt-cart-shipping-overnight")).toContain("$15.00");
  });

  it("has exactly four preselected controls: protection, warranty, packaging, shipping", async () => {
    const markup = await render();
    const preselected = [
      ...(markup.match(/<input\b[^>]*>/g) ?? []).filter((tag) => hasAttr(tag, "checked")),
      ...(markup.match(/<button\b[^>]*>/g) ?? []).filter(
        (tag) => attr(tag, "aria-checked") === "true",
      ),
    ];
    expect(preselected).toHaveLength(4);
    expect(isChecked(markup, "cart-protection-prechecked")).toBe(true);
    expect(isChecked(markup, "cart-warranty-radio-preselected")).toBe(true);
    expect(isChecked(markup, "cart-cheapest-shipping-default")).toBe(true);
    expect(attr(openTag(markup, "cart-packaging-switch-on"), "aria-checked")).toBe("true");
  });

  it("makes the cheapest shipping option the cheapest of the three", async () => {
    const markup = await render();
    const prices = ["cart-cheapest-shipping-default", "bt-cart-shipping-express", "bt-cart-shipping-overnight"].map(
      (id) => Number(/\$(\d+\.\d{2})/.exec(labelText(markup, id))?.[1]),
    );
    expect(prices[0]).toBe(Math.min(...prices));
    expect(new Set(prices).size).toBe(3);
  });
});

describe("cart page words", () => {
  it("has none of handling, haunting or phone in the visible text", async () => {
    const text = visibleText(await render()).toLowerCase();
    for (const word of ["handling", "haunting", "phone"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("allows the word insurance in the line and the summary row", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Insurance $4.00");
  });
});

describe("cart page safety", () => {
  it("has no add-to-cart control", async () => {
    const text = visibleText(await render()).toLowerCase();
    expect(text).not.toContain("add to cart");
  });

  it("has no form, no img, no text input and only checkbox or radio inputs", async () => {
    const markup = await render();
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<textarea");
    const inputs = markup.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const tag of inputs) {
      expect(["checkbox", "radio"], tag).toContain(attr(tag, "type"));
    }
  });

  it("gives every button type=button", async () => {
    const markup = await render();
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const tag of buttons) expect(attr(tag, "type"), tag).toBe("button");
  });

  it("has no overlay", async () => {
    const markup = await render();
    expect(markup).not.toContain("bt-banner");
    expect(markup).not.toContain("bt-dialog");
    expect(markup).not.toContain("bt-toast");
  });
});
