import { describe, it, expect } from "vitest";
import { renderRoute } from "./helpers/render-route";
import type { RouteTableEntry } from "./helpers/route-table";
import { countTestId } from "./helpers/markup";
import { formatUsd, summaryRows, type SummaryView } from "@/lib/boo-tique/cart";

/** Local one-entry tables, so this test does not depend on ROUTE_TABLE. */
const CART_TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/cart", load: () => import("@/app/boo-tique/cart/page") },
];
const CHECKOUT_TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique/checkout", load: () => import("@/app/boo-tique/checkout/page") },
];

type Row = { label: string; price: string };

const CART_ID = "bt-cart-summary";
const HONEST_ID = "checkout-consistent-shipping-tax";
const DEFAULT_ID = "checkout-handling-fees-drip";

/** Rows of the `<dl>` that carries the test id. */
function rowsOf(markup: string, id: string): Row[] {
  expect(countTestId(markup, id), id).toBe(1);
  const idx = markup.indexOf(`data-testid="${id}"`);
  const end = markup.indexOf("</dl>", idx);
  expect(end, `end of ${id}`).toBeGreaterThan(idx);
  const dl = markup.slice(idx, end);
  return [...dl.matchAll(/<dt>([^<]*)<\/dt><dd class="bt-price">([^<]*)<\/dd>/g)].map((m) => ({
    label: m[1],
    price: m[2],
  }));
}

function parseUsd(text: string): number {
  const m = /^(-?)\$(\d+)\.(\d{2})$/.exec(text);
  if (!m) throw new Error(`Not a price: ${text}`);
  const cents = Number(m[2]) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}

async function cartRows(): Promise<Row[]> {
  const markup = await renderRoute("/boo-tique/cart", { table: CART_TABLE });
  return rowsOf(markup, CART_ID);
}
async function honestRows(): Promise<Row[]> {
  const markup = await renderRoute("/boo-tique/checkout?flow=honest", { table: CHECKOUT_TABLE });
  return rowsOf(markup, HONEST_ID);
}
async function defaultRows(): Promise<Row[]> {
  const markup = await renderRoute("/boo-tique/checkout", { table: CHECKOUT_TABLE });
  return rowsOf(markup, DEFAULT_ID);
}

function withoutTotal(rows: readonly Row[]): Row[] {
  return rows.filter((r) => r.label !== "Total");
}
function totalOf(rows: readonly Row[]): Row {
  const total = rows.find((r) => r.label === "Total");
  if (!total) throw new Error("No Total row");
  return total;
}
function isTax(row: Row): boolean {
  return row.label === "Estimated tax" || row.label === "Tax";
}

describe("parseUsd helper", () => {
  it("reads a price in cents", () => {
    expect(parseUsd("$67.69")).toBe(6769);
    expect(parseUsd("$0.00")).toBe(0);
    expect(() => parseUsd("67.69")).toThrow();
  });
});

describe("cart rows and honest checkout rows", () => {
  it("have the same labels and prices except the tax label", async () => {
    const cart = await cartRows();
    const honest = await honestRows();
    expect(honest).toHaveLength(cart.length);
    for (let i = 0; i < cart.length; i += 1) {
      expect(honest[i].price, `price ${i}`).toBe(cart[i].price);
      if (isTax(cart[i])) {
        expect(cart[i].label).toBe("Estimated tax");
        expect(honest[i].label).toBe("Tax");
      } else {
        expect(honest[i].label, `label ${i}`).toBe(cart[i].label);
      }
    }
  });

  it("show Total $67.69 on both views", async () => {
    expect(totalOf(await cartRows()).price).toBe("$67.69");
    expect(totalOf(await honestRows()).price).toBe("$67.69");
  });
});

describe("default checkout rows", () => {
  it("equal the honest rows plus the two fee rows, except the total", async () => {
    const honest = await honestRows();
    const standard = await defaultRows();
    const rest = standard.filter((r) => r.label !== "Handling" && r.label !== "Haunting fee");
    expect(withoutTotal(rest)).toEqual(withoutTotal(honest));
    expect(totalOf(rest).price).not.toBe(totalOf(honest).price);
  });

  it("show the two fees before the total", async () => {
    const rows = await defaultRows();
    const labels = rows.map((r) => r.label);
    expect(labels.slice(-3)).toEqual(["Handling", "Haunting fee", "Total"]);
  });

  it("differ from the honest total by 999 cents, the two fees added", async () => {
    const honest = await honestRows();
    const standard = await defaultRows();
    const fees = standard.filter((r) => r.label === "Handling" || r.label === "Haunting fee");
    expect(fees.map((r) => r.price)).toEqual(["$6.99", "$3.00"]);
    const feeCents = fees.reduce((acc, r) => acc + parseUsd(r.price), 0);
    expect(feeCents).toBe(999);
    expect(parseUsd(totalOf(standard).price) - parseUsd(totalOf(honest).price)).toBe(feeCents);
  });

  it("shows Total $77.68", async () => {
    expect(totalOf(await defaultRows()).price).toBe("$77.68");
  });
});

describe("every view adds up", () => {
  it("has rows that sum to the total in the cart, honest and default views", async () => {
    for (const rows of [await cartRows(), await honestRows(), await defaultRows()]) {
      const sum = withoutTotal(rows).reduce((acc, r) => acc + parseUsd(r.price), 0);
      expect(sum).toBe(parseUsd(totalOf(rows).price));
    }
  });
});

describe("rendered figures come from the shared source", () => {
  const VIEWS: readonly { view: SummaryView; rows: () => Promise<Row[]> }[] = [
    { view: "cart", rows: cartRows },
    { view: "checkout-honest", rows: honestRows },
    { view: "checkout-default", rows: defaultRows },
  ];

  for (const { view, rows } of VIEWS) {
    it(`matches summaryRows("${view}") label and formatUsd of the cents`, async () => {
      const expected = summaryRows(view).map((r) => ({
        label: r.label,
        price: formatUsd(r.cents),
      }));
      expect(await rows()).toEqual(expected);
    });
  }
});
