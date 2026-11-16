import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderRoute, matchRoutePattern } from "./helpers/render-route";
import type { PageProps, RouteTableEntry } from "./helpers/route-table";
import {
  attr,
  countTestId,
  decodeEntities,
  hasAttr,
  openTag,
  testIds,
  textOf,
  visibleText,
} from "./helpers/markup";

type Seen = { params: unknown; searchParams: unknown };
const seen: Seen[] = [];

/** Fake page: records the props it got and echoes the resolved values as JSON text. */
async function echoPage({ params, searchParams }: PageProps) {
  seen.push({ params, searchParams });
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  return createElement(
    "pre",
    { "data-testid": "bt-echo" },
    JSON.stringify({ params: resolvedParams, searchParams: resolvedSearch }),
  );
}

/** Fake page that finishes later, so a missing `await` would fail. */
async function slowPage() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return createElement("p", { "data-testid": "bt-slow" }, "slow done");
}

const table: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique", load: async () => ({ default: echoPage }) },
  { pattern: "/boo-tique/product/[slug]", load: async () => ({ default: echoPage }) },
  { pattern: "/boo-tique/slow", load: async () => ({ default: slowPage }) },
];

async function echo(route: string): Promise<{ params: unknown; searchParams: unknown }> {
  const markup = await renderRoute(route, { table });
  return JSON.parse(textOf(markup, "bt-echo")) as {
    params: unknown;
    searchParams: unknown;
  };
}

describe("renderRoute", () => {
  it("passes the query string as a searchParams record", async () => {
    const result = await echo("/boo-tique?banner=ghost&x=1");
    expect(result.searchParams).toEqual({ banner: "ghost", x: "1" });
  });

  it("passes an empty record when there is no query string", async () => {
    const result = await echo("/boo-tique");
    expect(result.searchParams).toEqual({});
    expect(result.params).toEqual({});
  });

  it("turns a repeated key into an array", async () => {
    const result = await echo("/boo-tique?banner=ghost&banner=equal&banner=x");
    expect(result.searchParams).toEqual({ banner: ["ghost", "equal", "x"] });
  });

  it("resolves params from a [slug] segment", async () => {
    const result = await echo("/boo-tique/product/ghost-pepper-candle");
    expect(result.params).toEqual({ slug: "ghost-pepper-candle" });
  });

  it("decodes percent-encoded params", async () => {
    const result = await echo("/boo-tique/product/a%20b");
    expect(result.params).toEqual({ slug: "a b" });
  });

  it("passes params and searchParams to the page as Promises", async () => {
    seen.length = 0;
    await renderRoute("/boo-tique?a=1", { table });
    expect(seen).toHaveLength(1);
    expect(seen[0].params).toBeInstanceOf(Promise);
    expect(seen[0].searchParams).toBeInstanceOf(Promise);
  });

  it("awaits the page function", async () => {
    const markup = await renderRoute("/boo-tique/slow", { table });
    expect(textOf(markup, "bt-slow")).toBe("slow done");
  });

  it("wraps the output in the shell by default", async () => {
    const markup = await renderRoute("/boo-tique", { table });
    expect(countTestId(markup, "bt-demo-notice")).toBe(1);
    expect(markup).toContain("bt-root");
    expect(countTestId(markup, "bt-echo")).toBe(1);
  });

  it("does not wrap the output when shell is false", async () => {
    const markup = await renderRoute("/boo-tique", { table, shell: false });
    expect(countTestId(markup, "bt-demo-notice")).toBe(0);
    expect(markup).not.toContain("bt-root");
    expect(countTestId(markup, "bt-echo")).toBe(1);
  });

  it("throws an error that contains the path for an unmatched path", async () => {
    await expect(renderRoute("/boo-tique/nope?x=1", { table })).rejects.toThrow(
      "No route-table entry for /boo-tique/nope",
    );
  });

  it("does not match a [slug] pattern with a missing or extra segment", async () => {
    await expect(renderRoute("/boo-tique/product", { table })).rejects.toThrow(
      "/boo-tique/product",
    );
    await expect(renderRoute("/boo-tique/product/a/b", { table })).rejects.toThrow(
      "/boo-tique/product/a/b",
    );
  });

  it("uses the shared ROUTE_TABLE when no table is given", async () => {
    await expect(renderRoute("/boo-tique/not-a-real-page")).rejects.toThrow(
      "No route-table entry for /boo-tique/not-a-real-page",
    );
  });
});

describe("matchRoutePattern", () => {
  it("matches a static pattern and returns no params", () => {
    expect(matchRoutePattern("/boo-tique/cart", "/boo-tique/cart")).toEqual({});
  });

  it("ignores a trailing slash", () => {
    expect(matchRoutePattern("/boo-tique/cart", "/boo-tique/cart/")).toEqual({});
  });

  it("returns null for a different path", () => {
    expect(matchRoutePattern("/boo-tique/cart", "/boo-tique/club")).toBeNull();
  });

  it("captures a dynamic segment", () => {
    expect(matchRoutePattern("/a/[id]/b", "/a/42/b")).toEqual({ id: "42" });
  });
});

describe("markup helpers", () => {
  const markup =
    '<div><p data-testid="bt-a" title="handling">Insurance &#x27;x&#x27; &amp; co</p>' +
    '<p data-testid="bt-b">Hello <b>world</b></p></div>';

  it("testIds lists every data-testid in order", () => {
    expect(testIds(markup)).toEqual(["bt-a", "bt-b"]);
  });

  it("countTestId counts exact matches only", () => {
    expect(countTestId(markup, "bt-a")).toBe(1);
    expect(countTestId(markup, "bt")).toBe(0);
    expect(countTestId(markup, "bt-c")).toBe(0);
  });

  it("textOf removes tags and decodes entities", () => {
    expect(textOf(markup, "bt-a")).toBe("Insurance 'x' & co");
    expect(textOf(markup, "bt-b")).toBe("Hello world");
  });

  it("textOf is empty for a void element", () => {
    const m = '<label><input type="checkbox" data-testid="cart-x" checked=""/> Gift</label>';
    expect(textOf(m, "cart-x")).toBe("");
  });

  it("textOf and openTag throw for a missing id", () => {
    expect(() => textOf(markup, "bt-missing")).toThrow("bt-missing");
    expect(() => openTag(markup, "bt-missing")).toThrow("bt-missing");
  });

  it("openTag returns the opening tag of the carrying element", () => {
    expect(openTag(markup, "bt-a")).toBe('<p data-testid="bt-a" title="handling">');
  });

  it("hasAttr and attr read attributes regardless of order", () => {
    const tag = openTag(
      '<input type="checkbox" data-testid="cart-x" checked="" aria-checked="true"/>',
      "cart-x",
    );
    expect(hasAttr(tag, "checked")).toBe(true);
    expect(hasAttr(tag, "disabled")).toBe(false);
    expect(attr(tag, "type")).toBe("checkbox");
    expect(attr(tag, "aria-checked")).toBe("true");
    expect(attr(tag, "checked")).toBe("");
    expect(attr(tag, "missing")).toBeUndefined();
  });

  it("hasAttr does not match inside another attribute value or name", () => {
    const tag = openTag('<div class="a checked b" data-testid="bt-c" aria-checked="true">x</div>', "bt-c");
    expect(hasAttr(tag, "checked")).toBe(false);
    expect(hasAttr(tag, "class")).toBe(true);
    expect(attr(tag, "class")).toBe("a checked b");
  });

  it("decodeEntities handles named and numeric entities", () => {
    expect(decodeEntities("&#x27;&#39;&quot;&lt;&gt;&amp;")).toBe("''\"<>&");
  });
});

describe("visibleText", () => {
  const markup =
    '<div><p data-testid="bt-a" title="handling">Insurance &#x27;x&#x27; &amp; co</p>' +
    '<p data-testid="bt-b" title="phone">Hello <b>world</b></p></div>';

  it("removes tags and attributes and decodes entities", () => {
    expect(visibleText(markup)).toBe("Insurance 'x' & co Hello world");
    expect(visibleText(markup)).not.toContain("handling");
    expect(visibleText(markup)).not.toContain("phone");
    expect(visibleText(markup)).not.toContain("bt-a");
  });

  it("cuts out the elements named in exclude", () => {
    expect(visibleText(markup, { exclude: ["bt-a"] })).toBe("Hello world");
    expect(visibleText(markup, { exclude: ["bt-a", "bt-b"] })).toBe("");
  });

  it("balances nested tags of the same name when cutting", () => {
    const nested =
      '<section><div data-testid="bt-o"><div>inner</div>after</div>tail</section>';
    expect(visibleText(nested, { exclude: ["bt-o"] })).toBe("tail");
  });

  it("cuts a void element without eating following text", () => {
    const m = '<p><input type="checkbox" data-testid="cart-x" checked=""/>keep</p>';
    expect(visibleText(m, { exclude: ["cart-x"] })).toBe("keep");
  });

  it("ignores an excluded id that is not in the markup", () => {
    expect(visibleText(markup, { exclude: ["bt-none"] })).toBe(
      "Insurance 'x' & co Hello world",
    );
  });

  it("does not scan test ids, so an id such as cart-insurance-sneaked is not visible text", () => {
    const m = '<li data-testid="cart-insurance-sneaked">Line</li>';
    expect(visibleText(m).toLowerCase()).not.toContain("insurance");
  });
});
