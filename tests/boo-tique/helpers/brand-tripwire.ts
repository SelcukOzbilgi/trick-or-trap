/**
 * Real brand names that must never appear in the Boo-tique. This is a negative test list
 * only: tests match it against rendered text and source text, and no shop code imports it.
 */
export const BRAND_TRIPWIRE: readonly string[] = [
  "Amazon",
  "Walmart",
  "Target",
  "eBay",
  "Etsy",
  "Shopify",
  "Nike",
  "Apple",
  "IKEA",
  "Visa",
  "Mastercard",
  "PayPal",
  "Stripe",
  "Klarna",
  "Amex",
];
