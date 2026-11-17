import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, hasAttr, openTag, textOf, visibleText } from "./helpers/markup";
import { ACCOUNT_PLANS, formatUsd } from "@/lib/boo-tique/cart";

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
const WORDS = ["insurance", "handling", "haunting", "phone"];
const CLUB_PLAN_TEXT = `${ACCOUNT_PLANS.club.name}, ${formatUsd(ACCOUNT_PLANS.club.cents)}/month`;
const BASIC_PLAN_TEXT = `${ACCOUNT_PLANS.basic.name}, ${formatUsd(ACCOUNT_PLANS.basic.cents)}/month`;

/** Attribute names of an opening tag, sorted. */
function attrNames(tag: string): string[] {
  const afterName = tag.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, "");
  return [...afterName.matchAll(/\s([^\s=/>"']+)(?:="[^"]*")?/g)].map((m) => m[1]).sort();
}

/** Opening tag of the first <section> that has the given aria-labelledby value. */
function sectionTagLabelledBy(markup: string, labelId: string): string {
  const tags = markup.match(/<section\b[^>]*>/g) ?? [];
  const found = tags.find((tag) => attr(tag, "aria-labelledby") === labelId);
  expect(found, labelId).toBeDefined();
  return found ?? "";
}

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
  it("shows the plan from ACCOUNT_PLANS, Midnight Club Monthly, $9.99/month", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE));
    expect(CLUB_PLAN_TEXT).toBe("Midnight Club Monthly, $9.99/month");
    expect(text).toContain(CLUB_PLAN_TEXT);
  });

  it("has account-cancel-five-screens once, as a visible <section> with the cancel heading label", async () => {
    const markup = await render(DEFAULT_ROUTE);
    expect(countTestId(markup, CANCEL_ID)).toBe(1);
    const tag = openTag(markup, CANCEL_ID);
    expect(tag.startsWith("<section")).toBe(true);
    expect(attr(tag, "class")).toBe("bt-card");
    expect(attr(tag, "aria-labelledby")).toBe("bt-cancel-heading");
    expect(hasAttr(tag, "hidden")).toBe(false);
  });

  it("heads the section Cancel membership and tells the member to call during opening hours", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const section = elementMarkup(markup, CANCEL_ID, "section");
    expect(section).toContain('<h2 id="bt-cancel-heading">Cancel membership</h2>');
    expect(textOf(markup, CANCEL_ID)).toBe(
      "Cancel membership To cancel, call us during opening hours.",
    );
  });

  it("has no digit, link, button or input inside the section", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const section = elementMarkup(markup, CANCEL_ID, "section");
    expect(section).not.toContain("<a ");
    expect(section).not.toContain("<button");
    expect(section).not.toContain("<input");
    expect(section).not.toContain("tel:");
    expect(textOf(markup, CANCEL_ID)).not.toMatch(/\d/);
  });

  it("gives the cancel section the attribute names of the plan card plus data-testid", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const plan = sectionTagLabelledBy(markup, "bt-plan-heading");
    const cancel = openTag(markup, CANCEL_ID);
    expect(attrNames(cancel)).toEqual([...attrNames(plan), "data-testid"].sort());
  });

  it("has no data- attribute other than the one data-testid on the cancel section", async () => {
    const markup = await render(DEFAULT_ROUTE);
    const section = elementMarkup(markup, CANCEL_ID, "section");
    const dataAttrs = [...section.matchAll(/\sdata-[a-z-]+/g)].map((m) => m[0].trim());
    expect(dataAttrs).toEqual(["data-testid"]);
  });

  it("has none of insurance, handling, haunting or phone in the visible text of the page", async () => {
    const text = visibleText(await render(DEFAULT_ROUTE)).toLowerCase();
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

  it("shows the plan from ACCOUNT_PLANS, Moonlight Basic, $4.99/month, in the card", async () => {
    const text = textOf(await render(HONEST_ROUTE), HONEST_ID);
    expect(BASIC_PLAN_TEXT).toBe("Moonlight Basic, $4.99/month");
    expect(text).toContain(BASIC_PLAN_TEXT);
  });

  it("has exactly one button, a plain bt-button Cancel plan, and no input", async () => {
    const markup = await render(HONEST_ROUTE);
    const buttons = markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe('<button type="button" class="bt-button">Cancel plan</button>');
    expect(attr(buttons[0] ?? "", "class")).not.toContain("bt-button--quiet");
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

  it("has no retention offer text, no call text and no phone number", async () => {
    const text = visibleText(await render(HONEST_ROUTE)).toLowerCase();
    for (const phrase of [
      "call us",
      "call the shop",
      "discount",
      "% off",
      "stay",
      "before you go",
      "offer",
      ...WORDS,
    ]) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(/\d[\d\s().-]{6,}\d/.test(text)).toBe(false);
  });

  it("has no default cancel section and no hidden preview marker", async () => {
    const markup = await render(HONEST_ROUTE);
    expect(countTestId(markup, CANCEL_ID)).toBe(0);
    expect(markup).not.toContain("data-anchor");
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
