import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { attr, countTestId, openTag, textOf, visibleText } from "./helpers/markup";

/** Local one-entry table, so this test does not depend on ROUTE_TABLE. */
const TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/club", load: () => import("@/app/boo-tique/club/page") },
];

const ROUTE = "/boo-tique/club";

function render(): Promise<string> {
  return renderRoute(ROUTE, { table: TABLE });
}

function style(markup: string, id: string): string {
  const value = attr(openTag(markup, id), "style");
  if (value === undefined) throw new Error(`No style attribute on ${id}`);
  return value;
}

const ENTRY_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["club-modal-hate-saving", "No thanks, I hate saving money"],
  ["club-modal-full-price-mortal", "I'll pay full price like a mortal"],
  ["club-modal-no-need-protection", "Maybe later, I don't need protection"],
  ["club-plain-no-thanks", "No thanks"],
  ["club-timer-session-restart", "Join in 09:59 for 20% off"],
];

/** Accept and decline test ids of the four offer cards. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["bt-club-accept-discount", "club-modal-hate-saving"],
  ["bt-club-accept-shipping", "club-modal-full-price-mortal"],
  ["bt-club-accept-protection", "club-modal-no-need-protection"],
  ["bt-club-accept-newsletter", "club-plain-no-thanks"],
];

describe("club page entries", () => {
  it.each(ENTRY_TEXTS)("has %s once with its exact text", async (id, text) => {
    const markup = await render();
    expect(countTestId(markup, id)).toBe(1);
    expect(textOf(markup, id)).toBe(text);
  });

  it("shows the timer text 'Join in 09:59 for 20% off'", async () => {
    const markup = await render();
    expect(textOf(markup, "club-timer-session-restart")).toBe(
      "Join in 09:59 for 20% off",
    );
  });

  it("shows the accept button 'Yes, give me 20% off!' next to the first decline", async () => {
    const markup = await render();
    expect(textOf(markup, "bt-club-accept-discount")).toBe("Yes, give me 20% off!");
    const accept = markup.indexOf('data-testid="bt-club-accept-discount"');
    const decline = markup.indexOf('data-testid="club-modal-hate-saving"');
    expect(accept).toBeGreaterThan(-1);
    expect(decline).toBeGreaterThan(accept);
  });

  it("is deterministic across renders", async () => {
    expect(await render()).toBe(await render());
  });
});

describe("club page offer cards", () => {
  it("has four offer cards", async () => {
    const markup = await render();
    for (const id of [
      "bt-club-offer-discount",
      "bt-club-offer-shipping",
      "bt-club-offer-protection",
      "bt-club-offer-newsletter",
    ]) {
      expect(countTestId(markup, id), id).toBe(1);
    }
  });

  it("puts the protection decline inside the protection card", async () => {
    const markup = await render();
    expect(textOf(markup, "bt-club-offer-protection")).toContain(
      "Maybe later, I don't need protection",
    );
  });

  it("puts the plain No thanks inside the newsletter card", async () => {
    const markup = await render();
    const card = textOf(markup, "bt-club-offer-newsletter");
    expect(card).toContain("No thanks");
    expect(card).not.toContain("hate saving");
    expect(card).not.toContain("mortal");
    expect(card).not.toContain("don't need");
  });

  it("gives every accept and decline pair identical style attributes", async () => {
    const markup = await render();
    for (const [accept, decline] of PAIRS) {
      const acceptStyle = style(markup, accept);
      expect(acceptStyle, accept).not.toBe("");
      expect(style(markup, decline), decline).toBe(acceptStyle);
    }
  });

  it("uses one shared style across all four pairs", async () => {
    const markup = await render();
    const styles = new Set(PAIRS.flatMap((pair) => pair.map((id) => style(markup, id))));
    expect(styles.size).toBe(1);
  });

  it("renders the honest card's No thanks as a plain button", async () => {
    const markup = await render();
    const tag = openTag(markup, "club-plain-no-thanks");
    expect(tag.startsWith("<button")).toBe(true);
    expect(textOf(markup, "club-plain-no-thanks")).toBe("No thanks");
  });
});

describe("club page safety", () => {
  it("gives every button type=button", async () => {
    const markup = await render();
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    for (const tag of buttons) expect(attr(tag, "type"), tag).toBe("button");
  });

  it("has no form and no input", async () => {
    const markup = await render();
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<textarea");
  });

  it("has no overlay and no preselected control", async () => {
    const markup = await render();
    expect(markup).not.toContain("bt-banner");
    expect(markup).not.toContain("bt-dialog");
    expect(markup).not.toContain("bt-toast");
    expect(markup).not.toContain("checked");
  });

  it("has no other countdown or deadline copy", async () => {
    const text = visibleText(await render(), {
      exclude: ["club-timer-session-restart"],
    });
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text.toLowerCase()).not.toContain("ends");
    expect(text.toLowerCase()).not.toContain("left");
    expect(text.toLowerCase()).not.toContain("hurry");
  });
});
