/**
 * The side table from ground-truth entry ids to page-tree nodes (design section 13).
 * It is the only place where fixture entries meet snapshot nodes: detectors never see it,
 * and the node keys never enter a snapshot. Entries that no static detector can score
 * (`cart-insurance-sneaked`, `checkout-handling-fees-drip`, `account-cancel-five-screens`)
 * have no row.
 */

export type EntryMapping = {
  /** Variant ids of `pages.ts` that show the entry. The first one is the primary pair. */
  readonly variants: readonly string[];
  /** Key of the node that mirrors the element carrying the entry id in the markup. */
  readonly primary: string;
  /** Keys of the other nodes of the entry: accept control, label, text span, and so on. */
  readonly related: readonly string[];
  /** True when the whole page is the entry: any finding on the page counts. */
  readonly wholePage: boolean;
};

const HOME_DEFAULT = ["home-default-equal", "home-default-increase"] as const;
const PRODUCT = ["product-differing", "product-coinciding"] as const;

function row(variants: readonly string[], primary: string, related: readonly string[] = []): EntryMapping {
  return { variants, primary, related, wholePage: false };
}

function wholePage(variants: readonly string[], primary: string): EntryMapping {
  return { variants, primary, related: [], wholePage: true };
}

/** A checkbox or radio with its label and text span, as `choiceRow` of `pages.ts` builds them. */
function control(variants: readonly string[], slug: string): EntryMapping {
  return row(variants, `${slug}-input`, [`${slug}-label`, `${slug}-text`]);
}

export const ENTRY_MAP: Readonly<Record<string, EntryMapping>> = {
  // Flag entries (19)
  "home-hero-countdown-restart": row(HOME_DEFAULT, "hero-countdown"),
  "home-rolling-midnight-text": row(HOME_DEFAULT, "rolling-midnight"),
  "home-cookie-accept-dominant": row(HOME_DEFAULT, "cookie-banner", ["cookie-options", "cookie-accept"]),
  "home-cookie-ghost-reject": row(["home-ghost"], "cookie-banner", ["cookie-reject", "cookie-accept"]),
  "product-low-stock-random": row(PRODUCT, "low-stock"),
  "product-viewers-random": row(PRODUCT, "viewers"),
  "product-selling-fast-badge": row(PRODUCT, "selling-fast"),
  "product-almost-gone-tiny": row(PRODUCT, "almost-gone"),
  "product-sold-toast": row(PRODUCT, "sold-toast", ["sold-message"]),
  "product-upsell-modal-tiny-close": row(PRODUCT, "upsell-dialog", ["upsell-close", "upsell-add"]),
  "cart-protection-prechecked": control(["cart"], "protection"),
  "cart-warranty-radio-preselected": control(["cart"], "warranty-gold"),
  "cart-packaging-switch-on": row(["cart"], "packaging-switch", ["packaging-text"]),
  "checkout-newsletter-prechecked": control(["checkout-default"], "newsletter"),
  "club-modal-hate-saving": row(["club"], "hate-saving-decline", ["discount-accept"]),
  "club-modal-full-price-mortal": row(["club"], "full-price-decline", ["shipping-accept"]),
  "club-modal-no-need-protection": row(["club"], "no-need-protection-decline", ["protection-accept"]),
  "club-timer-session-restart": row(["club"], "club-timer"),
  "newsletter-partners-prechecked": row(["home-exit-intent"], "partners-input", ["partners-label"]),

  // Look-alike entries (8)
  "home-fixed-date-sale": row(HOME_DEFAULT, "fixed-date-sale"),
  "home-cookie-equal-buttons": row(["home-equal-banner"], "cookie-banner", ["cookie-accept", "cookie-reject"]),
  "product-real-inventory-3-left": row(PRODUCT, "real-inventory"),
  "cart-gift-wrap-unchecked": control(["cart"], "gift-wrap"),
  "cart-cheapest-shipping-default": control(["cart"], "shipping-standard"),
  "checkout-consistent-shipping-tax": wholePage(["checkout-honest"], "summary-honest"),
  "club-plain-no-thanks": row(["club"], "plain-no-thanks-decline", ["newsletter-accept"]),
  "account-one-click-cancel-plan": wholePage(["account-honest"], "plan-honest"),
};

/** Mapping of an entry. Throws on an entry that has no row. */
export function mappingOf(entryId: string): EntryMapping {
  const mapping = ENTRY_MAP[entryId];
  if (mapping === undefined) throw new Error(`Entry "${entryId}" has no row in the entry map.`);
  return mapping;
}

/** Every node key of an entry: the primary node first, then the related ones. */
export function nodesOf(entryId: string): readonly string[] {
  const mapping = mappingOf(entryId);
  return [mapping.primary, ...mapping.related];
}

/** The entries shown by a variant, in the order of the map. */
export function entriesOfVariant(variantId: string): ReadonlyArray<{ id: string; mapping: EntryMapping }> {
  return Object.entries(ENTRY_MAP)
    .filter(([, mapping]) => mapping.variants.includes(variantId))
    .map(([id, mapping]) => ({ id, mapping }));
}
