import { describe, it, expect } from "vitest";
import {
  ACCOUNT_PLANS,
  CART,
  CART_OPTIONS,
  DRIP_FEES,
  INSURANCE,
  TAX_RATE_PERCENT,
  addOnLabel,
  cartTotals,
  checkoutTotals,
  formatUsd,
  plainLabel,
  summaryRows,
  taxCents,
  type SummaryView,
} from "@/lib/boo-tique/cart";

const VIEWS: readonly SummaryView[] = ["cart", "checkout-honest", "checkout-default"];

function summary(view: SummaryView) {
  return summaryRows(view).map((row) => [row.key, row.label, row.cents] as const);
}

describe("formatUsd", () => {
  it("formats integer cents", () => {
    expect(formatUsd(1800)).toBe("$18.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(123456)).toBe("$1234.56");
    expect(formatUsd(-250)).toBe("-$2.50");
  });

  it("throws a RangeError for a value that is not an integer", () => {
    expect(() => formatUsd(1.5)).toThrow(RangeError);
    expect(() => formatUsd(Number.NaN)).toThrow(RangeError);
    expect(() => formatUsd(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("taxCents", () => {
  it("is 8 percent of the items total, rounded", () => {
    expect(TAX_RATE_PERCENT).toBe(8);
    expect(taxCents(4000)).toBe(320);
    expect(taxCents(0)).toBe(0);
    expect(taxCents(1)).toBe(0);
    expect(taxCents(7)).toBe(1);
  });
});

describe("CART_OPTIONS and labels", () => {
  it("holds the names and prices of 7.4", () => {
    const flat = (o: { id: string; name: string; cents: number }) => [o.id, o.name, o.cents];
    expect(flat(CART_OPTIONS.protection)).toEqual(["protection", "Add Raven Shipping Protection", 499]);
    expect(flat(CART_OPTIONS.giftWrap)).toEqual(["gift-wrap", "Gift wrap", 200]);
    expect(flat(CART_OPTIONS.packaging)).toEqual(["packaging", "Priority coffin packaging", 250]);
    expect(CART_OPTIONS.warranty.map(flat)).toEqual([
      ["warranty-none", "No warranty", 0],
      ["warranty-silver", "Silver Curse Warranty", 300],
      ["warranty-gold", "Gold Extended Curse Warranty", 900],
    ]);
    expect(CART_OPTIONS.shipping.map(flat)).toEqual([
      ["shipping-standard", "Standard coffin post", 400],
      ["shipping-express", "Express bat post", 900],
      ["shipping-overnight", "Overnight spirit post", 1500],
    ]);
  });

  it("builds add-on labels with a plus sign for a non-zero price", () => {
    expect(addOnLabel(CART_OPTIONS.protection)).toBe("Add Raven Shipping Protection +$4.99");
    expect(addOnLabel(CART_OPTIONS.giftWrap)).toBe("Gift wrap +$2.00");
    expect(addOnLabel(CART_OPTIONS.packaging)).toBe("Priority coffin packaging +$2.50");
    expect(addOnLabel(CART_OPTIONS.warranty[0])).toBe("No warranty $0.00");
    expect(addOnLabel(CART_OPTIONS.warranty[1])).toBe("Silver Curse Warranty +$3.00");
    expect(addOnLabel(CART_OPTIONS.warranty[2])).toBe("Gold Extended Curse Warranty +$9.00");
  });

  it("builds plain labels without a plus sign", () => {
    expect(plainLabel(CART_OPTIONS.shipping[0])).toBe("Standard coffin post $4.00");
    expect(plainLabel(CART_OPTIONS.shipping[1])).toBe("Express bat post $9.00");
    expect(plainLabel(CART_OPTIONS.shipping[2])).toBe("Overnight spirit post $15.00");
  });
});

describe("CART", () => {
  it("takes the lines from PRODUCTS", () => {
    expect(CART.lines.map((l) => [l.name, l.cents])).toEqual([
      ["Ghost Pepper Candle", 1800],
      ["Moon-Phase Mug", 2200],
    ]);
  });

  it("has exactly the three preselected extras, summing to 1649", () => {
    expect(CART.extras.map((e) => e.id)).toEqual(["protection", "warranty-gold", "packaging"]);
    expect(CART.extras.reduce((sum, e) => sum + e.cents, 0)).toBe(1649);
  });

  it("uses Standard shipping at 400", () => {
    expect(CART.shipping.id).toBe("shipping-standard");
    expect(CART.shipping.cents).toBe(400);
  });

  it("holds insurance, the drip fees and the account plans", () => {
    expect(CART.insurance).toEqual(INSURANCE);
    expect([INSURANCE.id, INSURANCE.name, INSURANCE.cents]).toEqual(["insurance", "Insurance", 400]);
    expect([DRIP_FEES.handling.id, DRIP_FEES.handling.name, DRIP_FEES.handling.cents]).toEqual([
      "handling",
      "Handling",
      699,
    ]);
    expect([DRIP_FEES.haunting.id, DRIP_FEES.haunting.name, DRIP_FEES.haunting.cents]).toEqual([
      "haunting",
      "Haunting fee",
      300,
    ]);
    expect(ACCOUNT_PLANS.club).toEqual({ name: "Midnight Club Monthly", cents: 999 });
    expect(ACCOUNT_PLANS.basic).toEqual({ name: "Moonlight Basic", cents: 499 });
  });
});

describe("summaryRows", () => {
  it("returns the cart rows", () => {
    expect(summary("cart")).toEqual([
      ["items", "Items", 4000],
      ["extras", "Extras", 1649],
      ["shipping", "Shipping", 400],
      ["insurance", "Insurance", 400],
      ["tax", "Estimated tax", 320],
      ["total", "Total", 6769],
    ]);
  });

  it("returns the honest checkout rows", () => {
    expect(summary("checkout-honest")).toEqual([
      ["items", "Items", 4000],
      ["extras", "Extras", 1649],
      ["shipping", "Shipping", 400],
      ["insurance", "Insurance", 400],
      ["tax", "Tax", 320],
      ["total", "Total", 6769],
    ]);
  });

  it("returns the default checkout rows with the two fees before the total", () => {
    expect(summary("checkout-default")).toEqual([
      ["items", "Items", 4000],
      ["extras", "Extras", 1649],
      ["shipping", "Shipping", 400],
      ["insurance", "Insurance", 400],
      ["tax", "Tax", 320],
      ["handling", "Handling", 699],
      ["haunting", "Haunting fee", 300],
      ["total", "Total", 7768],
    ]);
  });

  it("sums every view's rows, without the total, to its total", () => {
    for (const view of VIEWS) {
      const rows = summaryRows(view);
      const total = rows.find((r) => r.key === "total");
      const sum = rows.filter((r) => r.key !== "total").reduce((s, r) => s + r.cents, 0);
      expect(sum).toBe(total?.cents);
    }
  });

  it("makes the honest rows equal the cart rows except the tax label", () => {
    const cart = summaryRows("cart");
    const honest = summaryRows("checkout-honest");
    expect(honest).toHaveLength(cart.length);
    cart.forEach((row, i) => {
      expect(honest[i].key).toBe(row.key);
      expect(honest[i].cents).toBe(row.cents);
      if (row.key === "tax") {
        expect(row.label).toBe("Estimated tax");
        expect(honest[i].label).toBe("Tax");
      } else {
        expect(honest[i].label).toBe(row.label);
      }
    });
  });

  it("makes the default rows differ from the honest rows by the two fees and the total", () => {
    const honest = summaryRows("checkout-honest");
    const withoutFees = summaryRows("checkout-default").filter(
      (r) => r.key !== "handling" && r.key !== "haunting",
    );
    expect(withoutFees.filter((r) => r.key !== "total")).toEqual(
      honest.filter((r) => r.key !== "total"),
    );
    const honestTotal = honest.find((r) => r.key === "total")?.cents ?? 0;
    const defaultTotal = withoutFees.find((r) => r.key === "total")?.cents ?? 0;
    expect(defaultTotal - honestTotal).toBe(999);
  });
});

describe("totals", () => {
  it("computes the cart total", () => {
    const totals = cartTotals();
    expect(totals.totalCents).toBe(6769);
    expect(totals.feesCents).toBe(0);
    expect(totals.itemsCents).toBe(4000);
    expect(totals.extrasCents).toBe(1649);
    expect(totals.shippingCents).toBe(400);
    expect(totals.insuranceCents).toBe(400);
    expect(totals.taxCents).toBe(320);
  });

  it("computes the checkout totals", () => {
    expect(checkoutTotals("honest").totalCents).toBe(6769);
    expect(checkoutTotals("honest").feesCents).toBe(0);
    expect(checkoutTotals("default").totalCents).toBe(7768);
    expect(checkoutTotals("default").feesCents).toBe(999);
  });
});
