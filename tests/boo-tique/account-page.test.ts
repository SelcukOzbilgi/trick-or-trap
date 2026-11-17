import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, textOf, visibleText } from "./helpers/markup";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  {
    pattern: "/boo-tique/account/subscription",
    load: () => import("@/app/boo-tique/account/subscription/page"),
  },
];

const DEFAULT_ROUTE = "/boo-tique/account/subscription";
const HONEST_ROUTE = "/boo-tique/account/subscription?plan=honest";
const CANCEL_ID = "account-cancel-five-screens";
const HONEST_ID = "account-one-click-cancel-plan";
const PREVIEW_LABEL = "Static preview of a later flow";
const WORDS = ["insurance", "handling", "haunting", "phone"];

function render(route: string): Promise<string> {
  return renderRoute(route, { table: TABLE });
}

/** The element of the given tag that carries the test id, as markup. */
function elementMarkup(markup: string, id: string, tag: string): string {
  const idx = markup.indexOf(`data-testid="${id}"`);
  const start = markup.lastIndexOf(`<${tag}`, idx);
  const end = markup.indexOf(`</${tag}>`, idx);
  expect(start, id).toBeGreaterThan(-1);
  expect(end, id).toBeGreaterThan(idx);
  return markup.slice(start, end);
}

describe("account page default view", () => {
  it("shows the plan Midnight Club Monthly at $9.99/month", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE));
    expect(text).toContain("Midnight Club Monthly");
    expect(text).toContain("$9.99/month");
  });

  it("has account-cancel-five-screens once, as a visible <section>", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, CANCEL_ID)).toBe(1);
    const tag = openTag(markup, CANCEL_ID);
    expect(tag.startsWith("<section")).toBe(true);
    expect(attr(tag, "data-anchor")).toBe("phase-2");
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("heads the section Cancel membership and tells the member to call the shop", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const section = elementMarkup(markup, CANCEL_ID, "section");
    expect(/<h[1-6][^>]*>Cancel membership<\/h[1-6]>/.test(section)).toBe(true);
    const text = textOf(markup, CANCEL_ID);
    expect(text.toLowerCase()).toContain("call the shop");
    expect(text).toContain(PREVIEW_LABEL);
  });

  it("has no phone number, link, button or input inside the section", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const section = elementMarkup(markup, CANCEL_ID, "section");
    expect(section).not.toContain("<a ");
    expect(section).not.toContain("<button");
    expect(section).not.toContain("<input");
    expect(section).not.toContain("tel:");
    expect(/\d[\d\s().-]{6,}\d/.test(textOf(markup, CANCEL_ID))).toBe(false);
  });

  it("has none of insurance, handling, haunting or phone outside the section", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE), { exclude: [CANCEL_ID] }).toLowerCase();
    for (const word of WORDS) expect(text, word).not.toContain(word);
  });

  it("does not contain the honest plan card", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, HONEST_ID)).toBe(0);
    expect(visibleText(markup)).not.toContain("Moonlight Basic");
  });

  it("has no form and no input", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<input");
  });

  it("is deterministic across renders", async () => {
    expect(await render(DEFAULT_ROUTE)).toBe(await render(DEFAULT_ROUTE));
  });
});

describe("account page honest view", () => {
  it("has account-one-click-cancel-plan once, as a visible <section> card", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, HONEST_ID)).toBe(1);
    const tag = openTag(markup, HONEST_ID);
    expect(tag.startsWith("<section")).toBe(true);
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("shows Moonlight Basic at $4.99/month in the card", async () => {
    const text = textOf(await render(HONEST_ROUTE), HONEST_ID);
    expect(text).toContain("Moonlight Basic");
    expect(text).toContain("$4.99/month");
  });

  it("has exactly one button, a type=button Cancel plan, and no input", async () => {
    const markup = await render(HONEST_ROUTE);
    const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(attr(buttons[0] ?? "", "type")).toBe("button");
    expect(buttons[0] ?? "").toMatch(/>Cancel plan<\/button>$/);
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<form");
  });

  it("has the button inside the card", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(elementMarkup(markup, HONEST_ID, "section")).toContain("Cancel plan");
  });

  it("has none of insurance, handling, haunting or phone anywhere in its visible text", async () => {
    const text = visibleText(await render(HONEST_ROUTE)).toLowerCase();
    for (const word of WORDS) expect(text, word).not.toContain(word);
  });

  it("has no retention offer text, no call-the-shop text and no phone number", async () => {
    const text = visibleText(await render(HONEST_ROUTE)).toLowerCase();
    for (const phrase of ["call the shop", "discount", "% off", "stay", "before you go", "offer"]) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(/\d[\d\s().-]{6,}\d/.test(text)).toBe(false);
  });

  it("has no phase-2 preview and no default cancel section", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, CANCEL_ID)).toBe(0);
    expect(markup).not.toContain("phase-2");
    expect(visibleText(markup)).not.toContain(PREVIEW_LABEL);
  });
});

describe("account page variants", () => {
  it("renders the default markup for an unknown plan value", async () => {
    expect(await render("/boo-tique/account/subscription?plan=foo")).toBe(
      await render(DEFAULT_ROUTE),
    );
  });

  it("uses the first value of a repeated plan key", async () => {
    const honest = await render("/boo-tique/account/subscription?plan=honest&plan=foo");
    expect(countTestId(honest, HONEST_ID)).toBe(1);
    const fallback = await render("/boo-tique/account/subscription?plan=foo&plan=honest");
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
