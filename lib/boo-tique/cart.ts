import { PRODUCTS } from "./content";

/** One priced line or option. Amounts are integer cents. */
export type CartOption = { readonly id: string; readonly name: string; readonly cents: number };

/** "$18.00". Integer cents only. -250 gives "-$2.50". A non-integer throws RangeError. */
export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`formatUsd needs an integer number of cents, got ${String(cents)}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars}.${rest < 10 ? "0" : ""}${rest}`;
}

export const CART_OPTIONS: {
  readonly protection: CartOption;
  readonly giftWrap: CartOption;
  readonly packaging: CartOption;
  readonly warranty: readonly CartOption[];
  readonly shipping: readonly CartOption[];
} = {
  protection: { id: "protection", name: "Add Raven Shipping Protection", cents: 499 },
  giftWrap: { id: "gift-wrap", name: "Gift wrap", cents: 200 },
  packaging: { id: "packaging", name: "Priority coffin packaging", cents: 250 },
  warranty: [
    { id: "warranty-none", name: "No warranty", cents: 0 },
    { id: "warranty-silver", name: "Silver Curse Warranty", cents: 300 },
    { id: "warranty-gold", name: "Gold Extended Curse Warranty", cents: 900 },
  ],
  shipping: [
    { id: "shipping-standard", name: "Standard coffin post", cents: 400 },
    { id: "shipping-express", name: "Express bat post", cents: 900 },
    { id: "shipping-overnight", name: "Overnight spirit post", cents: 1500 },
  ],
};

/** The row that sits in the cart without the visitor adding it. */
export const INSURANCE: CartOption = { id: "insurance", name: "Insurance", cents: 400 };

export const DRIP_FEES: { readonly handling: CartOption; readonly haunting: CartOption } = {
  handling: { id: "handling", name: "Handling", cents: 699 },
  haunting: { id: "haunting", name: "Haunting fee", cents: 300 },
};

export const TAX_RATE_PERCENT = 8;

const CART_LINE_SLUGS = ["ghost-pepper-candle", "moon-phase-mug"] as const;

function cartLine(slug: string): CartOption {
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) throw new Error(`Cart line has no product: ${slug}`);
  return { id: product.slug, name: product.name, cents: product.priceUsd * 100 };
}

function byId(options: readonly CartOption[], id: string): CartOption {
  const found = options.find((o) => o.id === id);
  if (!found) throw new Error(`Unknown cart option: ${id}`);
  return found;
}

export const CART: {
  readonly lines: readonly CartOption[];
  readonly extras: readonly CartOption[];
  readonly shipping: CartOption;
  readonly insurance: CartOption;
} = {
  lines: CART_LINE_SLUGS.map(cartLine),
  extras: [
    CART_OPTIONS.protection,
    byId(CART_OPTIONS.warranty, "warranty-gold"),
    CART_OPTIONS.packaging,
  ],
  shipping: byId(CART_OPTIONS.shipping, "shipping-standard"),
  insurance: INSURANCE,
};

export const ACCOUNT_PLANS: {
  readonly club: { readonly name: string; readonly cents: number };
  readonly basic: { readonly name: string; readonly cents: number };
} = {
  club: { name: "Midnight Club Monthly", cents: 999 },
  basic: { name: "Moonlight Basic", cents: 499 },
};

/** "Gift wrap +$2.00". A zero price has no plus sign: "No warranty $0.00". */
export function addOnLabel(option: CartOption): string {
  return option.cents === 0
    ? `${option.name} ${formatUsd(option.cents)}`
    : `${option.name} +${formatUsd(option.cents)}`;
}

/** "Standard coffin post $4.00". */
export function plainLabel(option: CartOption): string {
  return `${option.name} ${formatUsd(option.cents)}`;
}

/** Tax is charged on the items total only. */
export function taxCents(itemsCents: number): number {
  return Math.round((itemsCents * TAX_RATE_PERCENT) / 100);
}

export type SummaryKey =
  | "items"
  | "extras"
  | "shipping"
  | "insurance"
  | "tax"
  | "handling"
  | "haunting"
  | "total";
export type SummaryRow = {
  readonly key: SummaryKey;
  readonly label: string;
  readonly cents: number;
};
export type SummaryView = "cart" | "checkout-honest" | "checkout-default";

export type Totals = {
  readonly itemsCents: number;
  readonly extrasCents: number;
  readonly shippingCents: number;
  readonly insuranceCents: number;
  readonly taxCents: number;
  readonly feesCents: number;
  readonly totalCents: number;
};

function sum(options: readonly CartOption[]): number {
  return options.reduce((total, option) => total + option.cents, 0);
}

function totalsWithFees(feesCents: number): Totals {
  const itemsCents = sum(CART.lines);
  const extrasCents = sum(CART.extras);
  const shippingCents = CART.shipping.cents;
  const insuranceCents = CART.insurance.cents;
  const tax = taxCents(itemsCents);
  return {
    itemsCents,
    extrasCents,
    shippingCents,
    insuranceCents,
    taxCents: tax,
    feesCents,
    totalCents: itemsCents + extrasCents + shippingCents + insuranceCents + tax + feesCents,
  };
}

export function cartTotals(): Totals {
  return totalsWithFees(0);
}

export function checkoutTotals(variant: "honest" | "default"): Totals {
  return totalsWithFees(
    variant === "default" ? DRIP_FEES.handling.cents + DRIP_FEES.haunting.cents : 0,
  );
}

export function summaryRows(view: SummaryView): readonly SummaryRow[] {
  const totals =
    view === "cart"
      ? cartTotals()
      : view === "checkout-honest"
        ? checkoutTotals("honest")
        : checkoutTotals("default");
  const taxLabel = view === "cart" ? "Estimated tax" : "Tax";
  const fees: SummaryRow[] =
    view === "checkout-default"
      ? [
          { key: "handling", label: DRIP_FEES.handling.name, cents: DRIP_FEES.handling.cents },
          { key: "haunting", label: DRIP_FEES.haunting.name, cents: DRIP_FEES.haunting.cents },
        ]
      : [];
  return [
    { key: "items", label: "Items", cents: totals.itemsCents },
    { key: "extras", label: "Extras", cents: totals.extrasCents },
    { key: "shipping", label: "Shipping", cents: totals.shippingCents },
    { key: "insurance", label: INSURANCE.name, cents: totals.insuranceCents },
    { key: "tax", label: taxLabel, cents: totals.taxCents },
    ...fees,
    { key: "total", label: "Total", cents: totals.totalCents },
  ];
}
