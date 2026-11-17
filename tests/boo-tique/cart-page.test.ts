import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, textOf, visibleText } from "./helpers/markup";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/cart", load: () => import("@/app/boo-tique/cart/page") },
];

const ROUTE = "/boo-tique/cart";
const PREVIEW_ID = "cart-insurance-sneaked";
const PREVIEW_LABEL = "Static preview of a later flow";

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

describe("cart page lines and totals", () => {
  it("lists the two product lines at their prices", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Ghost Pepper Candle");
    expect(text).toContain("$18.00");
    expect(text).toContain("Moon-Phase Mug");
    expect(text).toContain("$22.00");
  });

  it("shows items $40.00 and estimated tax $3.20", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Items $40.00");
    expect(text).toContain("Estimated tax $3.20");
  });

  it("is deterministic across renders", async () => {
    expect(await render()).toBe(await render());
  });
});

describe("cart page preselected controls", () => {
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
    const labelId = attr(tag, "aria-labelledby");
    expect(labelId).toBeTruthy();
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

describe("cart page insurance preview", () => {
  it("has cart-insurance-sneaked once, as a visible <li> in the cart lines list", async () => {
    const markup = await render();
    expect(countTestId(markup, PREVIEW_ID)).toBe(1);
    const tag = openTag(markup, PREVIEW_ID);
    expect(tag.startsWith("<li")).toBe(true);
    expect(attr(tag, "data-anchor")).toBe("phase-2");
    expect(hasAttr(tag, "hidden")).toBe(false);
    const text = textOf(markup, PREVIEW_ID);
    expect(text).toContain("Insurance $4.00");
    expect(text).toContain(PREVIEW_LABEL);
  });

  it("sits in the same list as the two product lines", async () => {
    const markup = await render();
    const idx = markup.indexOf(`data-testid="${PREVIEW_ID}"`);
    const listStart = markup.lastIndexOf("<ul", idx);
    const listEnd = markup.indexOf("</ul>", idx);
    const list = markup.slice(listStart, listEnd);
    expect(list).toContain("Ghost Pepper Candle");
    expect(list).toContain("Moon-Phase Mug");
  });

  it("has no link, button or input inside the preview", async () => {
    const markup = await render();
    const idx = markup.indexOf(`data-testid="${PREVIEW_ID}"`);
    const start = markup.lastIndexOf("<li", idx);
    const end = markup.indexOf("</li>", idx);
    const preview = markup.slice(start, end);
    expect(preview).not.toContain("<a ");
    expect(preview).not.toContain("<button");
    expect(preview).not.toContain("<input");
  });

  it("keeps the items total at the two product lines only", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Items $40.00");
    expect(text).not.toContain("$44.00");
  });

  it("has none of insurance, handling, haunting or phone outside the preview", async () => {
    const text = visibleText(await render(), { exclude: [PREVIEW_ID] }).toLowerCase();
    for (const word of ["insurance", "handling", "haunting", "phone"]) {
      expect(text, word).not.toContain(word);
    }
  });
});

describe("cart page safety", () => {
  it("has no add-to-cart control", async () => {
    const text = visibleText(await render()).toLowerCase();
    expect(text).not.toContain("add to cart");
  });

  it("has no form, no text input and only checkbox or radio inputs", async () => {
    const markup = await render();
    expect(markup).not.toContain("<form");
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
