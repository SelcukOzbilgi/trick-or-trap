/** URL prefix of every Boo-tique route. */
export const BOO_TIQUE_BASE_PATH = "/boo-tique";

/** Shown once, by the shell, on every Boo-tique page. */
export const DEMO_NOTICE_TEXT = "Demo shop, nothing is for sale";

export type NavLink = { readonly label: string; readonly href: string };

export type Product = {
  readonly slug: string;
  readonly name: string;
  readonly priceUsd: number;
  /** Star rating out of 5, whole stars. */
  readonly rating: number;
  /** Only the Ghost Pepper Candle has a page. */
  readonly href: string | null;
};

/** The six original product names. No was/now prices. */
export const PRODUCTS: readonly Product[] = [
  { slug: "cursed-candle-set", name: "Cursed Candle Set", priceUsd: 24, rating: 4, href: null },
  { slug: "phantom-hoodie", name: "Phantom Hoodie", priceUsd: 58, rating: 5, href: null },
  { slug: "moon-phase-mug", name: "Moon-Phase Mug", priceUsd: 22, rating: 4, href: null },
  { slug: "crypt-keeper-tote", name: "Crypt Keeper Tote", priceUsd: 26, rating: 4, href: null },
  { slug: "raven-feather-quill-pen", name: "Raven Feather Quill Pen", priceUsd: 14, rating: 3, href: null },
  {
    slug: "ghost-pepper-candle",
    name: "Ghost Pepper Candle",
    priceUsd: 18,
    rating: 5,
    href: `${BOO_TIQUE_BASE_PATH}/product/ghost-pepper-candle`,
  },
];

/** Text of `home-fixed-date-sale`. A fixed calendar date, so it is an honest look-alike. */
export const FIXED_SALE_TEXT = "Halloween sale ends 31 Oct 2026, 23:59 UTC";

/** Text of `home-rolling-midnight-text`. */
export const ROLLING_MIDNIGHT_TEXT = "Black Friday of the Dead ends at midnight";

/** Label before the hero countdown time. */
export const HERO_COUNTDOWN_LABEL = "Boo-nanza ends in";

/** Slug of the only product that has a page. */
export const PRODUCT_PAGE_SLUG = "ghost-pepper-candle";

export type VariantKey = "large-jar" | "travel-tin";

/** Real, fixed inventory per variant. It does not change between loads. */
export const INVENTORY: Readonly<Record<"travel-tin", number>> = {
  "travel-tin": 3,
};

/** Variant rows on the product page. Only the Travel tin has an inventory count. */
export const PRODUCT_VARIANTS: ReadonlyArray<{
  readonly key: VariantKey;
  readonly label: string;
}> = [
  { key: "large-jar", label: "Large jar" },
  { key: "travel-tin", label: "Travel tin" },
];

/** Header navigation. Plain anchors with relative hrefs. */
export const NAV_LINKS: readonly NavLink[] = [
  { label: "Home", href: BOO_TIQUE_BASE_PATH },
  { label: "Cart", href: `${BOO_TIQUE_BASE_PATH}/cart` },
  { label: "Club", href: `${BOO_TIQUE_BASE_PATH}/club` },
  { label: "Account", href: `${BOO_TIQUE_BASE_PATH}/account/subscription` },
];
